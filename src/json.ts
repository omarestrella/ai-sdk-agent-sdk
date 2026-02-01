import { logger } from "./logger";

/**
 * Safely serializes a value to JSON, handling circular references
 * by replacing them with `[Circular]`.
 */
export function safeJsonStringify(value: unknown, space?: string | number): string {
  const seen = new WeakSet();

  try {
    return JSON.stringify(
      value,
      (key, val) => {
        if (val === null || typeof val !== "object") {
          return val;
        }

        if (seen.has(val)) {
          return "[Circular]";
        }

        seen.add(val);
        return val;
      },
      space,
    );
  } catch (e) {
    const err = e as Error;
    logger.error("Cannot stringify JSON", {
      error: err.message,
      stack: err.stack,
    });
    return "{}";
  }
}
