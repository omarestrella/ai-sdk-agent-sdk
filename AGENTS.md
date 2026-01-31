# AI SDK Provider for Claude Agent SDK

This package wraps the Claude Agent SDK to work as an AI SDK provider for OpenCode. It enables AI SDK tools to be used through the Claude Agent SDK's API, handling message/tool conversions automatically.

## Quick Commands

```bash
bun install                    # Install deps
bun run build                  # Compile TypeScript
bun test                       # Run all tests
bun test test/messages.test.ts # Run specific test
bun test --grep "pattern"      # Run matching tests
bun run lint                   # Check with oxlint
bun run lint:fix               # Auto-fix lint issues
bun run fmt                    # Format with oxfmt
```

## Code Style

**TypeScript:** ES2022, strict mode, isolated modules

- Use `type` imports: `import type { Foo } from "bar"`
- Double quotes, no trailing commas, 2-space indent
- camelCase functions/files, PascalCase classes/interfaces

**Naming:**

- Functions: `convertMessages`, `doGenerate`
- Classes: `ClaudeAgentLanguageModel`
- Constants: `AI_SDK_MCP_SERVER_NAME`
- Private methods: camelCase (no underscore)

**Types:**

- Define return types on exports
- Use `interface` for objects, `type` for unions
- Prefer `unknown` over `any`

**Error Handling:**

```typescript
try {
  // operation
} catch (error) {
  logger.error("Failed to convert", { error });
  return defaultValue;
}
```

**JSON**:

All JSON.stringify calls must use `safeJsonStringify` in `src/json.ts`

## Key Implementation Details

**Tool Conversion:**

- AI SDK tools become MCP tools via `convertTools()`
- Uses Zod 4's `z.fromJSONSchema()` for parameter validation
- Tool names get `mcp__ai-sdk-tools__` prefix (stripped before returning to AI SDK)
- Set `allowedTools` to enable tool use in Agent SDK

**MCP Prefix Handling:**

The Agent SDK returns tool names with the format `mcp__{serverName}__{toolName}`. The AI SDK expects the original tool names. Always strip the prefix:

```typescript
function stripMcpPrefix(toolName: string): string {
  const prefix = `mcp__${AI_SDK_MCP_SERVER_NAME}__`;
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
}
```

This must be applied in both `doGenerate()` and `doStream()` when processing `tool_use` blocks.

**Message Conversion:**

- `convertMessages()` serializes conversation history
- System messages become systemPrompt
- User/assistant/tool messages formatted as tagged text

**Testing:**

- Use `bun:test` framework
- One describe per module, descriptive test names
- Test files: `test/{module}.test.ts`

## Critical Reminders

1. **Always run tests before committing:** `bun test`
2. **Always run linter:** `bun run lint`
3. **Code works without consola** - make it optional, not required
4. **Use Zod 4 features** - `z.fromJSONSchema()` for JSON Schema
5. **Handle MCP prefix** - Agent SDK returns `mcp__ai-sdk-tools__{tool}`, strip it before AI SDK sees it
