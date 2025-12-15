import fs from "fs";
import path from "path";
import { config } from "../config.js";

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel = LOG_LEVELS.info;
let logFile = null;

/**
 * Set the minimum log level
 * @param {"debug"|"info"|"warn"|"error"} level
 */
export function setLogLevel(level) {
  currentLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
}

/**
 * Initialize file logging for a pipeline run
 * @param {string} pipelineName - Name of the pipeline (e.g., "refresh", "enrichment")
 */
export function initFileLogging(pipelineName) {
  const logDir = config.pipeline.logDir;

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logDir, `${pipelineName}-${timestamp}.log`);

  logFile = fs.createWriteStream(logPath, { flags: "a" });

  log("info", `Logging to ${logPath}`);
}

/**
 * Close the log file
 */
export function closeFileLogging() {
  if (logFile) {
    logFile.end();
    logFile = null;
  }
}

/**
 * Internal log function
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} message
 * @param {Object} [data]
 */
function log(level, message, data = null) {
  if (LOG_LEVELS[level] < currentLevel) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  // Console output
  const consoleMsg = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;

  if (level === "error") {
    console.error(consoleMsg);
  } else if (level === "warn") {
    console.warn(consoleMsg);
  } else {
    console.log(consoleMsg);
  }

  // File output
  if (logFile) {
    const fileEntry = {
      timestamp,
      level,
      message,
      ...(data && { data }),
    };
    logFile.write(JSON.stringify(fileEntry) + "\n");
  }
}

// Public logging functions
export function debug(message, data) {
  log("debug", message, data);
}

export function info(message, data) {
  log("info", message, data);
}

export function warn(message, data) {
  log("warn", message, data);
}

export function error(message, data) {
  log("error", message, data);
}

/**
 * Create a logger with a specific prefix
 * @param {string} prefix - Prefix for all log messages (e.g., "[TMDB]")
 * @returns {Object} - Logger object with debug, info, warn, error methods
 */
export function createLogger(prefix) {
  return {
    debug: (msg, data) => debug(`${prefix} ${msg}`, data),
    info: (msg, data) => info(`${prefix} ${msg}`, data),
    warn: (msg, data) => warn(`${prefix} ${msg}`, data),
    error: (msg, data) => error(`${prefix} ${msg}`, data),
  };
}
