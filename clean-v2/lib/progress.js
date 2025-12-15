import fs from "fs";
import path from "path";
import { config } from "../config.js";

/**
 * Progress tracker for pipeline runs
 */
export class ProgressTracker {
  /**
   * @param {string} pipelineName - Name of the pipeline (e.g., "refresh", "enrichment")
   */
  constructor(pipelineName) {
    this.pipelineName = pipelineName;
    this.checkpointPath = path.join(config.pipeline.logDir, `${pipelineName}-checkpoint.json`);
    this.startedAt = new Date().toISOString();
    this.processed = 0;
    this.success = 0;
    this.failed = 0;
    this.skipped = 0;
    this.totalItems = 0;
    this.processedIds = new Set();
    this.lastCheckpoint = null;
  }

  /**
   * Set the total number of items to process
   * @param {number} total
   */
  setTotal(total) {
    this.totalItems = total;
  }

  /**
   * Record a successful item
   * @param {number|string} id - Item ID
   */
  recordSuccess(id) {
    this.processed++;
    this.success++;
    this.processedIds.add(id);
    this.maybeSaveCheckpoint();
  }

  /**
   * Record a failed item
   * @param {number|string} id - Item ID
   */
  recordFailure(id) {
    this.processed++;
    this.failed++;
    this.processedIds.add(id);
    this.maybeSaveCheckpoint();
  }

  /**
   * Record a skipped item
   * @param {number|string} id - Item ID
   */
  recordSkip(id) {
    this.processed++;
    this.skipped++;
    this.processedIds.add(id);
    this.maybeSaveCheckpoint();
  }

  /**
   * Check if an item was already processed
   * @param {number|string} id
   * @returns {boolean}
   */
  isProcessed(id) {
    return this.processedIds.has(id);
  }

  /**
   * Get progress percentage
   * @returns {number}
   */
  getProgressPercent() {
    if (this.totalItems === 0) return 0;
    return Math.round((this.processed / this.totalItems) * 100);
  }

  /**
   * Get estimated time remaining
   * @returns {string|null}
   */
  getEstimatedTimeRemaining() {
    if (this.processed === 0) return null;

    const elapsed = Date.now() - new Date(this.startedAt).getTime();
    const msPerItem = elapsed / this.processed;
    const remaining = this.totalItems - this.processed;
    const msRemaining = msPerItem * remaining;

    return formatDuration(msRemaining);
  }

  /**
   * Save checkpoint if interval reached
   */
  maybeSaveCheckpoint() {
    if (this.processed % config.pipeline.checkpointInterval === 0) {
      this.saveCheckpoint();
    }
  }

  /**
   * Force save checkpoint
   */
  saveCheckpoint() {
    const checkpoint = {
      pipelineName: this.pipelineName,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      totalItems: this.totalItems,
      processed: this.processed,
      success: this.success,
      failed: this.failed,
      skipped: this.skipped,
      progressPercent: this.getProgressPercent(),
      processedIds: Array.from(this.processedIds),
    };

    // Ensure directory exists
    const dir = path.dirname(this.checkpointPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.checkpointPath, JSON.stringify(checkpoint, null, 2));
    this.lastCheckpoint = checkpoint.updatedAt;
  }

  /**
   * Load checkpoint if exists
   * @returns {boolean} - True if checkpoint was loaded
   */
  loadCheckpoint() {
    if (!fs.existsSync(this.checkpointPath)) {
      return false;
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.checkpointPath, "utf8"));

      this.startedAt = data.startedAt;
      this.processed = data.processed || 0;
      this.success = data.success || 0;
      this.failed = data.failed || 0;
      this.skipped = data.skipped || 0;
      this.totalItems = data.totalItems || 0;
      this.processedIds = new Set(data.processedIds || []);

      return true;
    } catch (error) {
      console.error(`Failed to load checkpoint: ${error.message}`);
      return false;
    }
  }

  /**
   * Clear checkpoint file
   */
  clearCheckpoint() {
    if (fs.existsSync(this.checkpointPath)) {
      fs.unlinkSync(this.checkpointPath);
    }
  }

  /**
   * Get summary of progress
   * @returns {Object}
   */
  getSummary() {
    return {
      total: this.totalItems,
      processed: this.processed,
      success: this.success,
      failed: this.failed,
      skipped: this.skipped,
      progressPercent: this.getProgressPercent(),
      estimatedTimeRemaining: this.getEstimatedTimeRemaining(),
    };
  }

  /**
   * Print progress to console
   */
  printProgress() {
    const summary = this.getSummary();
    const eta = summary.estimatedTimeRemaining ? ` | ETA: ${summary.estimatedTimeRemaining}` : "";
    console.log(
      `Progress: ${summary.processed}/${summary.total} (${summary.progressPercent}%) | ` +
        `Success: ${summary.success} | Failed: ${summary.failed} | Skipped: ${summary.skipped}${eta}`
    );
  }
}

/**
 * Format duration in milliseconds to human readable string
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
