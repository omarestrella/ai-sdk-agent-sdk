import { describe, expect, test } from "bun:test";
import { convertMessages } from "../src/messages";
import type { LanguageModelV2Prompt } from "@ai-sdk/provider";

describe("convertMessages", () => {
  test("should convert system message", () => {
    const messages: LanguageModelV2Prompt = [
      { role: "system", content: "You are a helpful assistant." },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("You are a helpful assistant.");
    expect(result.prompt).toBe("");
  });

  test("should convert user text message", () => {
    const messages: LanguageModelV2Prompt = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello, how are you?" }],
      },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("");
    expect(result.prompt).toBe("[user]\nHello, how are you?");
  });

  test("should convert user file message", () => {
    const messages: LanguageModelV2Prompt = [
      {
        role: "user",
        content: [
          {
            type: "file",
            data: Buffer.from("test content").toString("base64"),
            mediaType: "application/pdf",
          },
        ],
      },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("");
    expect(result.prompt).toBe("[user]\n[File: application/pdf]");
  });

  test("should convert assistant text message", () => {
    const messages: LanguageModelV2Prompt = [
      {
        role: "assistant",
        content: [{ type: "text", text: "I'm doing well, thank you!" }],
      },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("");
    expect(result.prompt).toBe("[assistant]\nI'm doing well, thank you!");
  });

  test("should convert assistant tool call", () => {
    const messages: LanguageModelV2Prompt = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-123",
            toolName: "getWeather",
            input: { city: "San Francisco" },
          },
        ],
      },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("");
    expect(result.prompt).toContain('[tool_call: getWeather({"city":"San Francisco"})]');
  });

  test("should convert assistant reasoning", () => {
    const messages: LanguageModelV2Prompt = [
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "Let me think about this..." }],
      },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("");
    expect(result.prompt).toBe("[assistant]\n[thinking]\nLet me think about this...\n[/thinking]");
  });

  test("should convert tool result with text output", () => {
    const messages: LanguageModelV2Prompt = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-123",
            toolName: "getWeather",
            output: { type: "text", value: "Sunny, 72°F" },
          },
        ],
      },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("");
    expect(result.prompt).toContain("[tool_result: getWeather (id: call-123)]");
    expect(result.prompt).toContain('{"type":"text","value":"Sunny, 72°F"}');
  });

  test("should convert tool result with json output", () => {
    const messages: LanguageModelV2Prompt = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-456",
            toolName: "calculate",
            output: { type: "json", value: 42 },
          },
        ],
      },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("");
    expect(result.prompt).toContain("[tool_result: calculate (id: call-456)]");
    expect(result.prompt).toContain("42");
  });

  test("should handle full conversation flow", () => {
    const messages: LanguageModelV2Prompt = [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: [{ type: "text", text: "What's the weather?" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "getWeather",
            input: { city: "NYC" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "getWeather",
            output: { type: "text", value: "Rainy, 60°F" },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "It's rainy in NYC today." }],
      },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("You are a helpful assistant.");
    expect(result.prompt).toContain("[user]\nWhat's the weather?");
    expect(result.prompt).toContain('[tool_call: getWeather({"city":"NYC"})]');
    expect(result.prompt).toContain("It's rainy in NYC today.");
  });

  test("should handle empty messages", () => {
    const messages: LanguageModelV2Prompt = [];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("");
    expect(result.prompt).toBe("");
  });

  test("should handle multiple system messages", () => {
    const messages: LanguageModelV2Prompt = [
      { role: "system", content: "You are an AI assistant." },
      { role: "system", content: "Be concise and helpful." },
    ];

    const result = convertMessages(messages);

    expect(result.systemPrompt).toBe("You are an AI assistant.\n\nBe concise and helpful.");
  });
});
