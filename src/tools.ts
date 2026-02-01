import type { LanguageModelV2FunctionTool } from "@ai-sdk/provider";
import {
  createSdkMcpServer,
  tool,
  type McpServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import * as z from "zod";
import { waitForExecution } from "./execution-registry";
import { logger } from "./logger";

/**
 * The name of the MCP server that hosts AI SDK tools.
 * This is used to identify tools when the Agent SDK returns them
 * in the format: mcp__{SERVER_NAME}__{tool_name}
 */
export const AI_SDK_MCP_SERVER_NAME = "ai-sdk-tools";

/**
 * Extracts Zod schema from AI SDK tool inputSchema using Zod 4's native
 * JSON Schema conversion.
 */
function extractZodSchema(
  tool: LanguageModelV2FunctionTool,
): Record<string, z.ZodTypeAny> {
  const inputSchema = tool.inputSchema as Record<string, unknown> | undefined;

  if (!inputSchema || typeof inputSchema !== "object") {
    return {};
  }

  try {
    const zodSchema = z.fromJSONSchema(inputSchema);
    if (zodSchema instanceof z.ZodObject) {
      return zodSchema.shape;
    }
    return { value: zodSchema };
  } catch (error) {
    logger.error("Failed to convert JSON Schema to Zod:", {
      tool: tool.name,
      error,
    });
    return {};
  }
}

/**
 * Converts AI SDK function tool definitions into an in-process Agent SDK MCP server.
 *
 * Each AI SDK tool becomes an MCP tool with proper parameter validation.
 * The MCP handler blocks on a promise that gets resolved by the plugin hook
 * when OpenCode executes the tool. This bridges the Agent SDK and AI SDK
 * tool execution models.
 */
export function convertTools(tools: LanguageModelV2FunctionTool[] | undefined):
  | {
      mcpServer: McpServerConfig;
      allowedTools: string[];
    }
  | undefined {
  if (!tools || tools.length === 0) return undefined;

  logger.debug("Converting tools:", {
    count: tools.length,
    tools: tools.map((t) => t.name),
  });

  const mcpTools = tools.map((aiTool) => {
    const zodSchema = extractZodSchema(aiTool);

    logger.debug("Creating tool:", {
      name: aiTool.name,
      schemaKeys: Object.keys(zodSchema),
    });

    return tool(
      aiTool.name,
      aiTool.description ?? "",
      zodSchema,
      async (args, extra) => {
        // Extract tool call ID from extra (passed by Agent SDK via _meta)
        // Extra brittle, can probably break in future Agent SDK changes
        const meta = (extra as { _meta?: Record<string, unknown> })?._meta;
        const toolCallId = meta?.["claudecode/toolUseId"] as string | undefined;

        if (!toolCallId) {
          logger.error("No toolCallId in MCP handler extra", {
            toolName: aiTool.name,
            extra,
          });
          return {
            content: [
              { type: "text" as const, text: "Error: Missing tool call ID" },
            ],
            isError: true,
          };
        }

        logger.debug("MCP handler waiting for execution", {
          toolName: aiTool.name,
          toolCallId,
        });

        // Wait for execution to be registered by stream
        // This blocks until the plugin hook resolves it
        const result = await waitForExecution(toolCallId, aiTool.name, args);

        logger.debug("MCP handler received tool result", {
          toolName: aiTool.name,
          toolCallId,
          contentLength: result.content.length,
        });

        return {
          content: result.content,
          isError: result.isError,
        };
      },
    );
  });

  logger.info("Created MCP server with", mcpTools.length, "tools");

  const mcpServer = createSdkMcpServer({
    name: AI_SDK_MCP_SERVER_NAME,
    tools: mcpTools,
  });

  // Generate the allowed tool names with MCP prefix format
  const allowedTools = tools.map(
    (t) => `mcp__${AI_SDK_MCP_SERVER_NAME}__${t.name}`,
  );

  logger.debug("Allowed tools:", allowedTools);

  return { mcpServer, allowedTools };
}
