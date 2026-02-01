// `create` alias for compatibility with opencode's dynamic provider loader,
// which looks for a `create` function export from npm packages.
export { createClaudeAgent as create } from "./provider";
export { ToolPlugin } from "./plugin";
