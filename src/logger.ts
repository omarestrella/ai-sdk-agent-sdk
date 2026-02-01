import { createWriteStream, existsSync, mkdirSync } from "fs";
import type { WriteStream } from "fs";
import { homedir } from "os";
import { join } from "path";
import { safeJsonStringify } from "./json";

/**
 * This is a weird file. We want to log to a file, but only if the consola package
 * we are using is available.
 */

// Environment configuration
const LOG_LEVEL = (process.env.LOG_LEVEL as string) || "debug";
const LOG_DIR = process.env.LOG_DIR || join(homedir(), ".cache", "ai-sdk-claude-agent");
const LOG_FILE = process.env.LOG_FILE || "ai-sdk-claude-agent.log";

// Ensure log directory exists
if (!existsSync(LOG_DIR)) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Silent fail
  }
}

const LOG_FILE_PATH = join(LOG_DIR, LOG_FILE);

// Persistent write stream for file logging
let logStream: WriteStream | null = null;

function getLogStream(): WriteStream {
  if (!logStream) {
    logStream = createWriteStream(LOG_FILE_PATH, { flags: "a" });
  }
  return logStream;
}

// Type definitions for consola
interface ConsolaInstance {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  log: (message: string, ...args: unknown[]) => void;
}

let consolaInstance: ConsolaInstance | null = null;
let consolaLoadAttempted = false;

/**
 * Dynamically loads consola if available.
 * This is an optional peer dependency - if not installed, logging is a no-op.
 */
async function loadConsola(): Promise<ConsolaInstance | null> {
  if (consolaLoadAttempted) return consolaInstance;
  consolaLoadAttempted = true;

  try {
    // Dynamic import - will fail gracefully if consola is not installed
    const { createConsola } = await import("consola");

    const reporters = [];

    // File reporter configuration
    if (LOG_FILE) {
      reporters.push({
        log: (logObj: { level: number; args: unknown[]; date: Date }) => {
          // Consola levels: 0=fatal/error, 1=warn, 2=log, 3=info, 4=debug, 5=trace
          const levelNames: Record<number, string> = {
            0: "ERROR",
            1: "WARN",
            2: "LOG",
            3: "INFO",
            4: "DEBUG",
            5: "TRACE",
          };
          const levelName = levelNames[logObj.level] || "LOG";
          const message = logObj.args
            .map((arg) => (typeof arg === "object" ? safeJsonStringify(arg) : String(arg)))
            .join(" ");

          const line =
            safeJsonStringify({
              timestamp: logObj.date.toISOString(),
              level: levelName,
              message,
            }) + "\n";

          // Append to file using persistent stream
          getLogStream().write(line);
        },
      });
    }

    consolaInstance = createConsola({
      // Consola levels: 0=fatal/error, 1=warn, 2=log, 3=info, 4=debug, 5=trace
      level:
        LOG_LEVEL === "trace"
          ? 5
          : LOG_LEVEL === "debug"
            ? 4
            : LOG_LEVEL === "info"
              ? 3
              : LOG_LEVEL === "warn"
                ? 1
                : 0,
      reporters,
    }) as ConsolaInstance;

    consolaInstance.info("Logger initialized with consola", {
      level: LOG_LEVEL,
      file: LOG_FILE_PATH,
    });

    return consolaInstance;
  } catch {
    // consola is not installed - logging will be a no-op
    return null;
  }
}

// Initialize consola asynchronously
const consolaPromise = loadConsola();

/**
 * Logger interface that wraps consola if available, otherwise no-op.
 */
export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (consolaInstance) {
      consolaInstance.debug(message, ...args);
    } else {
      consolaPromise.then((c) => c?.debug(message, ...args));
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (consolaInstance) {
      consolaInstance.info(message, ...args);
    } else {
      consolaPromise.then((c) => c?.info(message, ...args));
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (consolaInstance) {
      consolaInstance.warn(message, ...args);
    } else {
      consolaPromise.then((c) => c?.warn(message, ...args));
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (consolaInstance) {
      consolaInstance.error(message, ...args);
    } else {
      consolaPromise.then((c) => c?.error(message, ...args));
    }
  },

  /**
   * Legacy method - logs at info level
   * @deprecated Use logger.info() or logger.debug() instead
   */
  log(message: string, ...args: unknown[]): void {
    this.info(message, ...args);
  },
};
