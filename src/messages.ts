import type { LanguageModelV2Prompt } from "@ai-sdk/provider";
import { safeJsonStringify } from "./json";
import { logger } from "./logger";

export interface ConvertedPrompt {
  systemPrompt: string;
  prompt: string;
}

/**
 * Converts an AI SDK LanguageModelV2 prompt (array of system/user/assistant/tool messages)
 * into a system prompt string and a user prompt string for the Claude Agent SDK's query().
 *
 * Since we use maxTurns: 1, the Agent SDK makes a single LLM call. We serialize the full
 * conversation history into the prompt so the LLM has context from prior turns.
 */
export function convertMessages(messages: LanguageModelV2Prompt): ConvertedPrompt {
  logger.debug("Converting messages:", { count: messages.length });

  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const message of messages) {
    logger.debug("Processing message:", { role: message.role });
    switch (message.role) {
      case "system": {
        systemParts.push(message.content);
        break;
      }

      case "user": {
        const parts: string[] = [];
        logger.debug("Processing user message parts:", { count: message.content.length });
        for (const part of message.content) {
          switch (part.type) {
            case "text":
              parts.push(part.text);
              break;
            case "file":
              parts.push(`[File: ${part.filename ?? part.mediaType}]`);
              break;
          }
        }
        if (parts.length > 0) {
          conversationParts.push(`[user]\n${parts.join("\n")}`);
        }
        break;
      }

      case "assistant": {
        const parts: string[] = [];
        logger.debug("Processing assistant message parts:", { count: message.content.length });
        for (const part of message.content) {
          switch (part.type) {
            case "text":
              parts.push(part.text);
              break;
            case "tool-call":
              parts.push(`[tool_call: ${part.toolName}(${safeJsonStringify(part.input)})]`);
              break;
            case "reasoning":
              parts.push(`[thinking]\n${part.text}\n[/thinking]`);
              break;
          }
        }
        if (parts.length > 0) {
          conversationParts.push(`[assistant]\n${parts.join("\n")}`);
        }
        break;
      }

      case "tool": {
        const parts: string[] = [];
        for (const part of message.content) {
          const output = part.output;
          let outputText: string;
          if (Array.isArray(output)) {
            // Output is LanguageModelV2ToolResultOutput (array of parts)
            outputText = output
              .map((o) => {
                if (o.type === "text") return o.text;
                return `[${o.type}]`;
              })
              .join("\n");
          } else {
            outputText = typeof output === "string" ? output : safeJsonStringify(output);
          }
          parts.push(`[tool_result: ${part.toolName} (id: ${part.toolCallId})]\n${outputText}`);
        }
        if (parts.length > 0) {
          conversationParts.push(parts.join("\n"));
        }
        break;
      }
    }
  }

  return {
    systemPrompt: systemParts.join("\n\n"),
    prompt: conversationParts.join("\n\n"),
  };
}
