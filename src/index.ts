export {
  createClaudeAgent,
  type ClaudeAgentProvider,
  type ClaudeAgentProviderSettings,
} from "./provider";

export { ClaudeAgentLanguageModel } from "./language-model";

// `create` alias for compatibility with opencode's dynamic provider loader,
// which looks for a `create` function export from npm packages.
export { createClaudeAgent as create } from "./provider";
