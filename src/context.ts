import { homedir } from "os";
import { join } from "path";
import { logger } from "./logger";

const CACHE_DIR = join(homedir(), ".cache", "ai-sdk-claude-agent");
const SESSION_MAP_FILE = join(CACHE_DIR, "session-map.json");

// In-memory session mapping w/ ID (OpenCode -> Claude)
let currentOpenCodeSessionID = "";
const sessionMap = new Map<string, string>();

interface SessionMapData {
  [openCodeSessionID: string]: string;
}

function loadSessionMap(): void {
  try {
    const fs = require("fs");
    if (fs.existsSync(SESSION_MAP_FILE)) {
      const data = fs.readFileSync(SESSION_MAP_FILE, "utf-8");
      const parsed: SessionMapData = JSON.parse(data);
      for (const [openCodeID, claudeID] of Object.entries(parsed)) {
        sessionMap.set(openCodeID, claudeID);
      }
      logger.debug("Loaded session map from disk", {
        count: sessionMap.size,
        file: SESSION_MAP_FILE,
      });
    }
  } catch (error) {
    logger.error("Failed to load session map", { error });
  }
}

/**
 * Saves the session mapping to disk.
 */
function saveSessionMap(): void {
  try {
    const fs = require("fs");
    // Ensure cache directory exists
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const data: SessionMapData = Object.fromEntries(sessionMap);
    fs.writeFileSync(SESSION_MAP_FILE, JSON.stringify(data, null, 2));
    logger.debug("Saved session map to disk", {
      count: sessionMap.size,
      file: SESSION_MAP_FILE,
    });
  } catch (error) {
    logger.error("Failed to save session map", { error });
  }
}

export function setOpenCodeSessionId(id: string): void {
  currentOpenCodeSessionID = id;
  logger.debug("Set current OpenCode session ID", { id });
}

export function getOpenCodeSessionId(): string {
  return currentOpenCodeSessionID;
}

export function getClaudeSessionId(): string | undefined {
  if (!currentOpenCodeSessionID) {
    return undefined;
  }
  // Lazy load if needed
  if (sessionMap.size === 0) {
    loadSessionMap();
  }
  return sessionMap.get(currentOpenCodeSessionID);
}

/**
 * Maps the current OpenCode session to a Claude session ID.
 * Called when we receive a new Claude session ID from the Agent SDK.
 */
export function setClaudeSessionId(claudeID: string): void {
  if (!currentOpenCodeSessionID) {
    logger.warn("Cannot set Claude session ID - no OpenCode session ID set");
    return;
  }
  // Lazy load if needed
  if (sessionMap.size === 0) {
    loadSessionMap();
  }
  sessionMap.set(currentOpenCodeSessionID, claudeID);
  saveSessionMap();
  logger.debug("Mapped OpenCode session to Claude session", {
    openCodeID: currentOpenCodeSessionID,
    claudeID,
  });
}

export function clearClaudeSessionId(): void {
  if (!currentOpenCodeSessionID) {
    return;
  }
  if (sessionMap.size === 0) {
    loadSessionMap();
  }
  sessionMap.delete(currentOpenCodeSessionID);
  saveSessionMap();
  logger.debug("Cleared Claude session mapping", {
    openCodeID: currentOpenCodeSessionID,
  });
}
