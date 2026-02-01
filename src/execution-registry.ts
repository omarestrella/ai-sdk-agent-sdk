import { logger } from "./logger";

export interface ToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

interface PendingExecution {
  id: string;
  promise: Promise<ToolResult>;
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  toolName: string;
  input: unknown;
  createdAt: number;
}

// Global singleton registry for cross-process tool execution
const pendingExecutions = new Map<string, PendingExecution>();

/**
 * Registers a new pending tool execution with a specific ID (from tool_use block).
 * The promise resolves when the plugin hook calls resolve() with the execution ID.
 */
export function registerExecution(
  id: string,
  toolName: string,
  input: unknown,
): Promise<ToolResult> {
  logger.debug("Registering tool execution", { toolName, id });

  // Create the promise that will block the MCP handler
  let resolveFn: (result: ToolResult) => void;
  let rejectFn: (error: Error) => void;

  const promise = new Promise<ToolResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  // Set timeout to prevent infinite hangs
  const timeout = setTimeout(() => {
    if (pendingExecutions.has(id)) {
      pendingExecutions.delete(id);
      rejectFn(new Error(`Tool execution timeout: ${toolName}`));
      logger.error("Tool execution timed out", { toolName, id });
    }
  }, 30000);

  // Store in registry
  pendingExecutions.set(id, {
    id,
    promise,
    resolve: resolveFn!,
    reject: rejectFn!,
    timeout,
    toolName,
    input,
    createdAt: Date.now(),
  });

  return promise;
}

/**
 * Gets a pending execution promise for the MCP handler to wait on.
 * Returns undefined if not found (execution hasn't been registered yet).
 */
export function getExecutionPromise(id: string): Promise<ToolResult> | undefined {
  const execution = pendingExecutions.get(id);
  if (!execution) {
    logger.warn("Execution not found when getting promise", { id });
    return undefined;
  }
  return execution.promise;
}

/**
 * Waits for an execution to be registered and returns its promise.
 * Polls for up to 5 seconds waiting for the execution to appear.
 */
export async function waitForExecution(
  id: string,
  toolName: string,
  _input: unknown,
): Promise<ToolResult> {
  // Check if already registered
  const existing = pendingExecutions.get(id);
  if (existing) {
    return existing.promise;
  }

  // Poll for registration
  const startTime = Date.now();
  const maxWait = 5000; // 5 seconds

  while (Date.now() - startTime < maxWait) {
    const execution = pendingExecutions.get(id);
    if (execution) {
      return execution.promise;
    }
    // Wait 10ms before checking again
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // Timeout - create and return a rejected promise
  logger.error("Timeout waiting for execution registration", { id, toolName });
  throw new Error(`Execution not registered in time: ${id}`);
}

/**
 * Resolves a pending execution with the tool result.
 * Called from the plugin hook when tool execution completes.
 */
export function resolveExecution(id: string, result: ToolResult): boolean {
  const execution = pendingExecutions.get(id);

  if (!execution) {
    logger.warn("Execution not found for resolution", { id });
    return false;
  }

  logger.debug("Resolving tool execution", {
    id,
    toolName: execution.toolName,
    resultType: typeof result,
  });

  // Clear timeout and remove from registry
  clearTimeout(execution.timeout);
  pendingExecutions.delete(id);

  // Resolve the promise - this unblocks the MCP handler!
  execution.resolve(result);
  return true;
}

/**
 * Rejects a pending execution with an error.
 */
export function rejectExecution(id: string, error: Error): boolean {
  const execution = pendingExecutions.get(id);

  if (!execution) {
    logger.warn("Execution not found for rejection", { id });
    return false;
  }

  logger.error("Rejecting tool execution", {
    id,
    toolName: execution.toolName,
    error: error.message,
  });

  clearTimeout(execution.timeout);
  pendingExecutions.delete(id);
  execution.reject(error);
  return true;
}

/**
 * Checks if an execution is pending.
 */
export function hasExecution(id: string): boolean {
  return pendingExecutions.has(id);
}

/**
 * Cleans up stale executions.
 */
export function cleanupExecutions(maxAgeMs: number = 60000): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, execution] of pendingExecutions) {
    if (now - execution.createdAt > maxAgeMs) {
      clearTimeout(execution.timeout);
      pendingExecutions.delete(id);
      execution.reject(new Error("Execution expired"));
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.warn("Cleaned up stale executions", { count: cleaned });
  }
}

/**
 * Gets count of pending executions (for debugging).
 */
export function getPendingExecutionCount(): number {
  return pendingExecutions.size;
}
