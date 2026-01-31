# ai-sdk-claude-agent

[AI SDK](https://sdk.vercel.ai/) provider that wraps the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), exposing it as a standard `LanguageModelV2`.

## Install

```bash
bun install ai-sdk-claude-agent @anthropic-ai/claude-agent-sdk
```

## Usage

```ts
import { createClaudeAgent } from "ai-sdk-claude-agent";
import { generateText, streamText } from "ai";

const provider = createClaudeAgent();

// Generate text
const { text } = await generateText({
  model: provider("claude-sonnet-4-5-20250929"),
  prompt: "Explain how async generators work in JavaScript.",
});

// Stream text
const result = streamText({
  model: provider("claude-sonnet-4-5-20250929"),
  prompt: "Write a haiku about TypeScript.",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

## How it works

- Calls the Agent SDK's `query()` with `maxTurns: 1` so the AI SDK controls the agentic loop
- All built-in Agent SDK tools are disabled (`allowedTools: []`)
- AI SDK tool definitions are passed through as in-process MCP tools via `createSdkMcpServer()`
- Streaming uses `includePartialMessages: true` to get raw Anthropic events, mapped to `LanguageModelV2StreamPart`

## Provider options

```ts
const provider = createClaudeAgent({
  name: "my-agent", // provider display name (default: "claude-agent")
  cwd: "/path/to/dir", // working directory for the agent
});
```

## Available models

| Model             | ID                           |
| ----------------- | ---------------------------- |
| Claude Sonnet 4.5 | `claude-sonnet-4-5-20250929` |
| Claude Opus 4.5   | `claude-opus-4-5-20251101`   |
| Claude Haiku 4.5  | `claude-haiku-4-5-20251001`  |

Any model ID supported by the Agent SDK can be used.

## Using with opencode

The Claude Agent SDK requires a Claude Code & Claude Account or Anthropic API key.

Install the [Claude Code CLI](https://code.claude.com/docs/en/setup) before you start.

Add to your `opencode.json`:

```json
{
  "provider": {
    "claude-agent": {
      "npm": "ai-sdk-claude-agent",
      "name": "Claude Agent SDK",
      "models": {
        "claude-sonnet-4-5-20250929": {
          "name": "Claude Sonnet 4.5 (Agent SDK)",
          "tool_call": true,
          "reasoning": true,
          "limit": { "context": 200000, "output": 64000 }
        }
      }
    }
  }
}
```

## License

MIT
