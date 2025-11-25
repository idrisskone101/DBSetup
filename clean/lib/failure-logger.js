/**
 * File-Based Failure Logger
 * Tracks failed enrichment operations for retry and debugging
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { categorizeError } from "./rate-limiter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Failure logger class for file-based error tracking
 */
export class FailureLogger {
  /**
   * @param {string} phaseName - Name of the pipeline phase
   * @param {string} logDir - Directory for log files (relative to clean/)
   */
  constructor(phaseName, logDir = "logs") {
    this.phaseName = phaseName;
    
    // Set up log directory relative to clean/
    this.logDir = path.resolve(__dirname, "..", logDir);
    
    // Create timestamped failure log file
    const timestamp = new Date().toISOString().split("T")[0];
    this.failureFile = path.join(this.logDir, `failures-${phaseName}-${timestamp}.json`);

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Load or initialize failures
    this.failures = this.load() || {
      phase: phaseName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalFailures: 0,
      failures: [],
      summary: {},
    };
  }

  /**
   * Load existing failures from file
   * @returns {Object|null} - Loaded failures or null
   */
  load() {
    try {
      if (fs.existsSync(this.failureFile)) {
        const data = fs.readFileSync(this.failureFile, "utf-8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn(`⚠️  Could not load failure log: ${error.message}`);
    }
    return null;
  }

  /**
   * Save failures to file
   */
  save() {
    try {
      this.failures.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.failureFile, JSON.stringify(this.failures, null, 2));
    } catch (error) {
      console.error(`❌ Failed to save failure log: ${error.message}`);
    }
  }

  /**
   * Log a failure
   * @param {number} titleId - ID of the failed title
   * @param {string} titleName - Name of the title (for readability)
   * @param {string} stage - Stage where failure occurred (tmdb, wiki, embeddings)
   * @param {Error|string} error - Error object or message
   * @param {Object} context - Additional context data
   */
  logFailure(titleId, titleName, stage, error, context = {}) {
    const errorType = error instanceof Error ? categorizeError(error) : "unknown_error";
    const errorMessage = error instanceof Error ? error.message : String(error);

    const failure = {
      titleId,
      titleName,
      stage,
      errorType,
      errorMessage,
      timestamp: new Date().toISOString(),
      retryCount: 0,
      resolved: false,
      context,
    };

    // Check if this title already has a failure for this stage
    const existingIndex = this.failures.failures.findIndex(
      (f) => f.titleId === titleId && f.stage === stage && !f.resolved
    );

    if (existingIndex >= 0) {
      // Update existing failure
      this.failures.failures[existingIndex].retryCount++;
      this.failures.failures[existingIndex].errorMessage = errorMessage;
      this.failures.failures[existingIndex].timestamp = failure.timestamp;
    } else {
      // Add new failure
      this.failures.failures.push(failure);
      this.failures.totalFailures++;
    }

    // Update summary
    if (!this.failures.summary[errorType]) {
      this.failures.summary[errorType] = 0;
    }
    this.failures.summary[errorType]++;

    this.save();
  }

  /**
   * Mark a failure as resolved
   * @param {number} titleId - ID of the title
   * @param {string} stage - Stage of the failure
   */
  markResolved(titleId, stage = null) {
    this.failures.failures.forEach((f) => {
      if (f.titleId === titleId && !f.resolved) {
        if (stage === null || f.stage === stage) {
          f.resolved = true;
          f.resolvedAt = new Date().toISOString();
        }
      }
    });
    this.save();
  }

  /**
   * Get all unresolved failures
   * @returns {Array} - Array of unresolved failure records
   */
  getUnresolvedFailures() {
    return this.failures.failures.filter((f) => !f.resolved);
  }

  /**
   * Get failed title IDs for retry
   * @param {string} stage - Optional stage filter
   * @param {number} maxRetries - Max retry count to include
   * @returns {number[]} - Array of title IDs to retry
   */
  getFailedTitleIds(stage = null, maxRetries = 3) {
    return this.failures.failures
      .filter((f) => {
        if (f.resolved) return false;
        if (f.retryCount >= maxRetries) return false;
        if (stage && f.stage !== stage) return false;
        return true;
      })
      .map((f) => f.titleId);
  }

  /**
   * Get failure summary by error type
   * @returns {Object} - { errorType: count }
   */
  getSummary() {
    return this.failures.summary;
  }

  /**
   * Get failure count
   * @returns {number} - Total unresolved failures
   */
  getFailureCount() {
    return this.failures.failures.filter((f) => !f.resolved).length;
  }

  /**
   * Print failure summary to console
   */
  printSummary() {
    const unresolved = this.getUnresolvedFailures();
    
    if (unresolved.length === 0) {
      console.log("✅ No failures recorded");
      return;
    }

    console.log("\n❌ Failure Summary:");
    console.log(`   Total unresolved: ${unresolved.length}`);
    console.log("");
    
    // Group by error type
    const byType = {};
    unresolved.forEach((f) => {
      byType[f.errorType] = (byType[f.errorType] || 0) + 1;
    });

    Object.entries(byType)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });

    // Group by stage
    const byStage = {};
    unresolved.forEach((f) => {
      byStage[f.stage] = (byStage[f.stage] || 0) + 1;
    });

    console.log("");
    console.log("   By stage:");
    Object.entries(byStage).forEach(([stage, count]) => {
      console.log(`   - ${stage}: ${count}`);
    });

    console.log(`\n   Failure log: ${this.failureFile}`);
  }

  /**
   * Clear resolved failures older than N days
   * @param {number} daysOld - Age threshold in days
   */
  cleanupOldFailures(daysOld = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    this.failures.failures = this.failures.failures.filter((f) => {
      if (!f.resolved) return true;
      return new Date(f.resolvedAt || f.timestamp) > cutoff;
    });

    this.save();
    console.log(`🗑️  Cleaned up resolved failures older than ${daysOld} days`);
  }

  /**
   * Export failures to CSV for analysis
   * @returns {string} - CSV content
   */
  exportToCsv() {
    const headers = ["titleId", "titleName", "stage", "errorType", "errorMessage", "retryCount", "resolved", "timestamp"];
    const rows = this.failures.failures.map((f) =>
      headers.map((h) => {
        const val = f[h];
        // Escape quotes and wrap in quotes if contains comma
        if (typeof val === "string" && (val.includes(",") || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(",")
    );

    return [headers.join(","), ...rows].join("\n");
  }
}

export default FailureLogger;

