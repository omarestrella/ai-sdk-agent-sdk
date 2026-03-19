import type { Hooks, Plugin } from "@opencode-ai/plugin";
import { resolveExecution, type ToolResult } from "./execution-registry";
import { logger } from "./logger";
import { setOpenCodeSessionId } from "./context";

export const ToolPlugin: Plugin = async () => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const sessionID = event.properties.info.id;
        logger.debug("Starting session", {
          sessionID,
        });
        setOpenCodeSessionId(sessionID);
      }
    },

    ["tool.execute.error" as any]: () => {
      // TODO: this needs to be added to opencode to suport catching errors and resolving tool calls
    },

    "tool.execute.after": async (input, output) => {
      const toolID = input.callID;
      const toolName = input.tool;
      const result = output.output;

      // Extract execution ID from output metadata
      // The _executionID was injected by the stream when it saw the tool_use
      const executionID = (output.metadata as { _executionID?: string })?._executionID || toolID;

      logger.debug("Tool executed hook fired", {
        toolID,
        toolName,
        executionID,
        result,
      });

      if (!executionID) {
        logger.warn("No executionID found in metadata - tool may not be managed by bridge", {
          toolName,
          toolID,
        });
        return;
      }

      // Convert result to ToolResult format
      // output.output is a string from the tool execution
      const toolResult: ToolResult = {
        content: [{ type: "text" as const, text: result }],
        isError: false, // Plugin hook doesn't expose error state directly
      };

      // Resolve the pending execution - this unblocks the MCP handler!
      const success = resolveExecution(executionID, toolResult);

      if (!success) {
        logger.error("Failed to resolve execution - execution not found", {
          executionID,
          toolName,
        });
      } else {
        logger.debug("Successfully resolved tool execution", {
          executionID,
          toolName,
        });
      }
    },
  } satisfies Hooks;
};
