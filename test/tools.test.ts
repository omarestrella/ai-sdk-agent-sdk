import { describe, expect, test } from "bun:test";
import { convertTools } from "../src/tools";
import type { LanguageModelV2FunctionTool } from "@ai-sdk/provider";

describe("convertTools", () => {
  test("should return undefined for empty tools array", () => {
    const result = convertTools([]);
    expect(result).toBeUndefined();
  });

  test("should return undefined for undefined tools", () => {
    const result = convertTools(undefined);
    expect(result).toBeUndefined();
  });

  test("should convert tool with simple string parameter", () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: "function",
        name: "getWeather",
        description: "Get the weather for a city",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
        },
      },
    ];

    const result = convertTools(tools);
    expect(result).toBeDefined();
    // The MCP server should be created successfully
  });

  test("should convert tool with multiple parameter types", () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: "function",
        name: "createUser",
        description: "Create a new user",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "integer" },
            email: { type: "string", format: "email" },
            isActive: { type: "boolean" },
          },
          required: ["name", "email"],
        },
      },
    ];

    const result = convertTools(tools);
    expect(result).toBeDefined();
  });

  test("should convert tool with nested object parameters", () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: "function",
        name: "updateConfig",
        description: "Update configuration",
        inputSchema: {
          type: "object",
          properties: {
            settings: {
              type: "object",
              properties: {
                theme: { type: "string" },
                notifications: { type: "boolean" },
              },
            },
          },
        },
      },
    ];

    const result = convertTools(tools);
    expect(result).toBeDefined();
  });

  test("should convert tool with array parameters", () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: "function",
        name: "addTags",
        description: "Add tags to an item",
        inputSchema: {
          type: "object",
          properties: {
            tags: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    ];

    const result = convertTools(tools);
    expect(result).toBeDefined();
  });

  test("should convert tool with enum parameters", () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: "function",
        name: "setPriority",
        description: "Set task priority",
        inputSchema: {
          type: "object",
          properties: {
            priority: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
          },
        },
      },
    ];

    const result = convertTools(tools);
    expect(result).toBeDefined();
  });

  test("should convert multiple tools", () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: "function",
        name: "getWeather",
        description: "Get weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
        },
      },
      {
        type: "function",
        name: "getTime",
        description: "Get current time",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];

    const result = convertTools(tools);
    expect(result).toBeDefined();
  });

  test("should handle tool without parameters", () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: "function",
        name: "getStatus",
        description: "Get system status",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];

    const result = convertTools(tools);
    expect(result).toBeDefined();
  });

  test("should convert tool with optional parameters", () => {
    const tools: LanguageModelV2FunctionTool[] = [
      {
        type: "function",
        name: "search",
        description: "Search items",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
          required: ["query"],
        },
      },
    ];

    const result = convertTools(tools);
    expect(result).toBeDefined();
  });
});
