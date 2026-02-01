import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Message,
  LanguageModelV2Prompt,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { registerExecution } from "./execution-registry";
import { safeJsonStringify } from "./json";
import { AI_SDK_MCP_SERVER_NAME, convertTools } from "./tools";
import { logger } from "./logger";
import { getClaudeSessionId, setClaudeSessionId } from "./context";

/**
 * Strips the MCP prefix from tool names returned by the Agent SDK.
 * The Agent SDK returns tools in format: mcp__{serverName}__{toolName}
 * The AI SDK expects just the original tool name.
 */
function stripMcpPrefix(toolName: string): string {
  const prefix = `mcp__${AI_SDK_MCP_SERVER_NAME}__`;
  if (toolName.startsWith(prefix)) {
    return toolName.slice(prefix.length);
  }
  return toolName;
}

function mapFinishReason(
  stopReason: string | null | undefined,
  hasToolCalls: boolean,
): LanguageModelV2FinishReason {
  if (hasToolCalls) return "tool-calls";

  switch (stopReason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop";
    case "tool_use":
      return "tool-calls";
    default:
      return "unknown";
  }
}

export interface ClaudeAgentLanguageModelConfig {
  provider: string;
  cwd?: string;
}

type DoGenerateOptions = Parameters<LanguageModelV2["doGenerate"]>[0];
type DoGenerateResult = Awaited<ReturnType<LanguageModelV2["doGenerate"]>>;
type DoStreamOptions = Parameters<LanguageModelV2["doStream"]>[0];
type DoStreamResult = Awaited<ReturnType<LanguageModelV2["doStream"]>>;

let idCounter = 0;
function generateId(): string {
  return `agent-${Date.now()}-${++idCounter}`;
}

export class ClaudeAgentLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2" as const;
  readonly modelId: string;
  readonly defaultObjectGenerationMode = undefined;

  private readonly config: ClaudeAgentLanguageModelConfig;

  constructor(modelId: string, config: ClaudeAgentLanguageModelConfig) {
    this.modelId = modelId;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return {};
  }

  private buildQueryOptions(options: LanguageModelV2CallOptions) {
    // Extract just the last user message as the prompt (Agent SDK manages conversation history)
    const lastUserMessage = this.getLastUserMessage(options.prompt);
    const convertedTools = convertTools(options.tools as any);

    const abortController = new AbortController();
    if (options.abortSignal) {
      options.abortSignal.addEventListener(
        "abort",
        abortController.abort.bind(abortController),
        { once: true },
      );
    }

    const queryOptions: Options = {
      model: this.modelId,
      permissionMode: "bypassPermissions" as const,
      allowDangerouslySkipPermissions: true,
      abortController,
      tools: [],
      maxTurns: 1,
      allowedTools: [`mcp__${AI_SDK_MCP_SERVER_NAME}__*`],
      ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
    };

    // Extract system prompt from conversation history
    const systemPrompt = this.extractSystemPrompt(options.prompt);
    if (systemPrompt) {
      queryOptions.systemPrompt = systemPrompt;
    }

    if (convertedTools?.mcpServer) {
      queryOptions.mcpServers = {
        [AI_SDK_MCP_SERVER_NAME]: convertedTools.mcpServer,
      };
    }

    return { prompt: lastUserMessage, queryOptions };
  }

  private getLastUserMessage(messages: LanguageModelV2Prompt): string {
    // Find the last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === "user") {
        // User content is Array<LanguageModelV2TextPart | LanguageModelV2FilePart>
        const userContent = message.content as Array<{
          type: string;
          text?: string;
        }>;
        // Concatenate all text parts
        return userContent
          .filter((part) => part.type === "text")
          .map((part) => part.text || "")
          .join("\n");
      }
    }
    return "";
  }

  private extractSystemPrompt(
    messages: LanguageModelV2Prompt,
  ): string | undefined {
    const systemMessages = messages
      .filter((msg: LanguageModelV2Message) => msg.role === "system")
      .map((msg) => (msg as { role: "system"; content: string }).content);
    return systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;
  }

  async doGenerate(options: DoGenerateOptions): Promise<DoGenerateResult> {
    const warnings: LanguageModelV2CallWarning[] = [];
    const { prompt, queryOptions } = this.buildQueryOptions(options);

    // Check if we have an existing Claude session to resume
    const existingClaudeSessionId = getClaudeSessionId();
    if (existingClaudeSessionId) {
      logger.debug("Resuming existing Claude session", {
        claudeSessionId: existingClaudeSessionId,
      });
      queryOptions.resume = existingClaudeSessionId;
    } else {
      logger.debug("Starting new Claude session (no existing session found)");
    }

    const generator = query({
      prompt,
      options: queryOptions,
    });

    const content: LanguageModelV2Content[] = [];
    let usage: LanguageModelV2Usage = {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    };
    let finishReason: LanguageModelV2FinishReason = "unknown";
    let hasToolCalls = false;

    // Track message UUIDs to avoid counting usage multiple times
    // Per SDK docs: all messages with same ID have identical usage
    const seenMessageIds = new Set<string>();

    for await (const message of generator) {
      if (
        message.type === "system" &&
        message.subtype === "init" &&
        !existingClaudeSessionId
      ) {
        const claudeSessionID = message.session_id;
        logger.debug("Starting Claude Session", {
          sessionID: claudeSessionID,
          model: message.model,
          claudeCodeVersion: message.claude_code_version,
        });
        setClaudeSessionId(claudeSessionID);
      }

      if (message.type === "assistant") {
        const apiMessage = message.message;
        const messageId = message.uuid;

        if (Array.isArray(apiMessage.content)) {
          for (const block of apiMessage.content) {
            if (block.type === "text") {
              content.push({ type: "text", text: block.text });
            } else if (block.type === "tool_use") {
              hasToolCalls = true;
              const originalToolName = stripMcpPrefix(block.name);

              // Register execution for this tool call
              // MCP handler will wait for this to be resolved by the plugin
              registerExecution(block.id, originalToolName, block.input);

              // Inject _executionId into tool input for correlation
              const inputWithId =
                typeof block.input === "object" && block.input !== null
                  ? { ...block.input, _executionId: block.id }
                  : block.input;

              content.push({
                type: "tool-call",
                toolCallId: block.id,
                toolName: originalToolName,
                input:
                  typeof inputWithId === "string"
                    ? inputWithId
                    : safeJsonStringify(inputWithId),
              });
            } else if (block.type === "thinking") {
              content.push({
                type: "reasoning",
                text: block.thinking ?? "",
              });
            }
          }

          // Only record usage once per unique message ID
          if (apiMessage.usage && messageId && !seenMessageIds.has(messageId)) {
            seenMessageIds.add(messageId);
            usage = {
              inputTokens: apiMessage.usage.input_tokens,
              outputTokens: apiMessage.usage.output_tokens,
              totalTokens:
                (apiMessage.usage.input_tokens ?? 0) +
                (apiMessage.usage.output_tokens ?? 0),
            };
            logger.debug("Usage reported in doGenerate", {
              messageId,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            });
          }

          finishReason = mapFinishReason(apiMessage.stop_reason, hasToolCalls);
        }
      }

      if (message.type === "result") {
        // Result message contains cumulative usage from all steps
        if (message.usage) {
          usage = {
            inputTokens: message.usage.input_tokens ?? usage.inputTokens,
            outputTokens: message.usage.output_tokens ?? usage.outputTokens,
            totalTokens: usage.totalTokens,
          };
          logger.debug("Final usage from result message", {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          });
        }
      }
    }

    // Calculate total tokens if we have both input and output
    if (usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
      usage.totalTokens = usage.inputTokens + usage.outputTokens;
    }

    return {
      content,
      finishReason,
      usage,
      warnings,
      request: { body: queryOptions },
      response: {
        headers: undefined,
      },
    };
  }

  async doStream(options: DoStreamOptions): Promise<DoStreamResult> {
    const warnings: LanguageModelV2CallWarning[] = [];
    const { prompt, queryOptions } = this.buildQueryOptions(options);

    queryOptions.includePartialMessages = true;

    // Check if we have an existing Claude session to resume
    const existingClaudeSessionId = getClaudeSessionId();
    if (existingClaudeSessionId) {
      logger.debug("Resuming existing Claude session in stream", {
        claudeSessionId: existingClaudeSessionId,
      });
      queryOptions.resume = existingClaudeSessionId;
    } else {
      logger.debug(
        "Starting new Claude session in stream (no existing session found)",
      );
    }

    const generator = query({
      prompt,
      options: queryOptions,
    });

    let hasToolCalls = false;

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings });

        let finishReason: LanguageModelV2FinishReason = "unknown";
        let usage: LanguageModelV2Usage = {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        };

        // Track active text block for start/delta/end lifecycle
        let activeTextId: string | null = null;
        // Track active reasoning block
        let activeReasoningId: string | null = null;

        // Track tool calls being streamed (keyed by content block index)
        const toolCalls: Map<
          number,
          { toolCallId: string; toolName: string; argsText: string }
        > = new Map();

        // Track message UUIDs to avoid counting usage multiple times
        // Per SDK docs: all messages with same ID have identical usage
        const seenMessageIds = new Set<string>();

        try {
          for await (const message of generator) {
            if (message.type === "system" && message.subtype === "init") {
              // We need to keep this session tied to the OpenCode session,
              // so we can do a "resume" in the agent SDK
              const claudeSessionID = message.session_id;
              logger.debug("Starting Claude Session", {
                sessionID: claudeSessionID,
                model: message.model,
                claudeCodeVersion: message.claude_code_version,
              });
              // Store the mapping from OpenCode session -> Claude session
              setClaudeSessionId(claudeSessionID);
            }

            if (message.type === "stream_event") {
              const event = message.event;

              if (!event || !event.type) continue;

              switch (event.type) {
                case "message_start": {
                  const msg = event.message;
                  if (msg) {
                    controller.enqueue({
                      type: "response-metadata",
                      id: msg.id,
                      timestamp: new Date(),
                      modelId: msg.model,
                    });
                    if (msg.usage) {
                      usage.inputTokens = msg.usage.input_tokens;
                      logger.debug(
                        "Initial usage reported in doStream (message_start)",
                        {
                          inputTokens: usage.inputTokens,
                        },
                      );
                    }
                  }
                  break;
                }

                case "content_block_start": {
                  const block = event.content_block;
                  const index = event.index as number;

                  if (block?.type === "text") {
                    activeTextId = generateId();
                    controller.enqueue({
                      type: "text-start",
                      id: activeTextId,
                    });
                  } else if (block?.type === "tool_use") {
                    hasToolCalls = true;
                    const id = block.id ?? generateId();
                    const originalToolName = stripMcpPrefix(block.name);

                    // Register execution for this tool call
                    // MCP handler will wait for this to be resolved by the plugin
                    registerExecution(id, originalToolName, {});

                    toolCalls.set(index, {
                      toolCallId: id,
                      toolName: block.name,
                      argsText: "",
                    });
                    controller.enqueue({
                      type: "tool-input-start",
                      id,
                      toolName: originalToolName,
                    });
                  } else if (block?.type === "thinking") {
                    activeReasoningId = generateId();
                    controller.enqueue({
                      type: "reasoning-start",
                      id: activeReasoningId,
                    });
                  }
                  break;
                }

                case "content_block_delta": {
                  const delta = event.delta;
                  const index = event.index as number;

                  if (delta?.type === "text_delta") {
                    if (!activeTextId) {
                      activeTextId = generateId();
                      controller.enqueue({
                        type: "text-start",
                        id: activeTextId,
                      });
                    }
                    controller.enqueue({
                      type: "text-delta",
                      id: activeTextId,
                      delta: delta.text,
                    });
                  } else if (delta?.type === "input_json_delta") {
                    const tc = toolCalls.get(index);
                    if (tc) {
                      tc.argsText += delta.partial_json;
                      controller.enqueue({
                        type: "tool-input-delta",
                        id: tc.toolCallId,
                        delta: delta.partial_json,
                      });
                    }
                  } else if (delta?.type === "thinking_delta") {
                    if (!activeReasoningId) {
                      activeReasoningId = generateId();
                      controller.enqueue({
                        type: "reasoning-start",
                        id: activeReasoningId,
                      });
                    }
                    controller.enqueue({
                      type: "reasoning-delta",
                      id: activeReasoningId,
                      delta: delta.thinking,
                    });
                  }
                  break;
                }

                case "content_block_stop": {
                  const index = event.index as number;
                  const tc = toolCalls.get(index);

                  if (tc) {
                    const originalToolName = stripMcpPrefix(tc.toolName);
                    // End the tool input stream
                    controller.enqueue({
                      type: "tool-input-end",
                      id: tc.toolCallId,
                    });
                    // Emit the complete tool call
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: tc.toolCallId,
                      toolName: originalToolName,
                      input: tc.argsText,
                    });
                    toolCalls.delete(index);
                  } else if (activeTextId) {
                    controller.enqueue({
                      type: "text-end",
                      id: activeTextId,
                    });
                    activeTextId = null;
                  } else if (activeReasoningId) {
                    controller.enqueue({
                      type: "reasoning-end",
                      id: activeReasoningId,
                    });
                    activeReasoningId = null;
                  }
                  break;
                }

                case "message_delta": {
                  if (event.usage) {
                    usage.outputTokens = event.usage.output_tokens;
                    if (usage.inputTokens !== undefined) {
                      usage.totalTokens =
                        usage.inputTokens + (event.usage.output_tokens ?? 0);
                    }
                    logger.debug(
                      "Usage delta reported in doStream (message_delta)",
                      {
                        outputTokens: usage.outputTokens,
                        totalTokens: usage.totalTokens,
                      },
                    );
                  }
                  finishReason = mapFinishReason(
                    event.delta?.stop_reason,
                    hasToolCalls,
                  );
                  break;
                }

                case "message_stop": {
                  logger.debug("Stream stopped");
                  break;
                }
              }
            } else if (message.type === "assistant") {
              // Full assistant message — only update finish reason, not usage
              // Usage is tracked from streaming events (message_start, message_delta)
              // Per SDK docs: assistant messages share usage with streaming events
              const apiMessage = message.message;
              const messageId = message.uuid;

              if (Array.isArray(apiMessage?.content)) {
                for (const block of apiMessage.content) {
                  if (block.type === "tool_use") {
                    hasToolCalls = true;
                  }
                }
              }

              // Don't overwrite usage from streaming events - they are more accurate
              // and already tracked. Only log if this is a new message ID.
              if (
                apiMessage?.usage &&
                messageId &&
                !seenMessageIds.has(messageId)
              ) {
                seenMessageIds.add(messageId);
              }

              if (apiMessage?.stop_reason) {
                finishReason = mapFinishReason(
                  apiMessage.stop_reason,
                  hasToolCalls,
                );
              }
            } else if (message.type === "result") {
              logger.debug("Stream ended", {
                subtype: message.subtype,
                durationMs: message.duration_ms,
                usage: message.usage,
                models: Object.keys(message.modelUsage),
              });
              const messageUsage = message.usage;
              usage = {
                inputTokens: messageUsage.input_tokens,
                outputTokens: messageUsage.output_tokens,
                totalTokens:
                  messageUsage.input_tokens + messageUsage.output_tokens,
                cachedInputTokens: messageUsage.cache_read_input_tokens,
              };
            }
          }
        } catch (error) {
          controller.enqueue({ type: "error", error });
        }

        // Close any dangling blocks
        if (activeTextId) {
          controller.enqueue({ type: "text-end", id: activeTextId });
        }
        if (activeReasoningId) {
          controller.enqueue({ type: "reasoning-end", id: activeReasoningId });
        }

        controller.enqueue({
          type: "finish",
          finishReason,
          usage,
        });

        controller.close();
      },
    });

    return {
      stream,
      request: { body: queryOptions },
      response: {
        headers: undefined,
      },
    };
  }
}
