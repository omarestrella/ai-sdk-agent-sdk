import type { LanguageModelV2 } from "@ai-sdk/provider";
import {
  ClaudeAgentLanguageModel,
  type ClaudeAgentLanguageModelConfig,
} from "./language-model";
import { safeJsonStringify } from "./json";
import { logger } from "./logger";

export interface ClaudeAgentProviderSettings {
  name?: string;

  /**
   * Working directory for the Agent SDK.
   * @default process.cwd()
   */
  cwd?: string;
}

export interface ClaudeAgentProvider {
  (modelId: string): LanguageModelV2;
  languageModel(modelId: string): LanguageModelV2;
}

export function createClaudeAgent(
  options: ClaudeAgentProviderSettings = {},
): ClaudeAgentProvider {
  const config: ClaudeAgentLanguageModelConfig = {
    provider: options.name ?? "claude-agent",
    cwd: options.cwd,
  };

  logger.debug("Creating agent with:", safeJsonStringify(options));

  const createLanguageModel = (modelId: string): LanguageModelV2 => {
    return new ClaudeAgentLanguageModel(modelId, config);
  };

  const provider = function (modelId: string) {
    return createLanguageModel(modelId);
  };

  provider.languageModel = createLanguageModel;

  return provider as ClaudeAgentProvider;
}
