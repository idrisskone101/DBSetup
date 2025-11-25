/**
 * Progress Tracker with Checkpointing
 * File-based progress persistence for resumable long-running operations
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Progress tracker class for managing JSON log files and checkpoints
 */
export class ProgressTracker {
  /**
   * @param {string} phaseName - Name of the pipeline phase
   * @param {number} totalItems - Total number of items to process
   * @param {string} logDir - Directory for log files (relative to clean/)
   */
  constructor(phaseName, totalItems, logDir = "logs") {
    this.phaseName = phaseName;
    this.totalItems = totalItems;
    
    // Set up log directory relative to clean/
    this.logDir = path.resolve(__dirname, "..", logDir);
    this.progressFile = path.join(this.logDir, `${phaseName}-progress.json`);

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Initialize or load existing progress
    this.progress = this.load() || this.createInitialProgress();
    this.startTime = Date.now();
  }

  /**
   * Create initial progress object
   */
  createInitialProgress() {
    return {
      phase: this.phaseName,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalItems: this.totalItems,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      progressPercent: 0,
      estimatedCompletion: null,
      checkpoint: null,
      processedIds: [],
      stats: {
        tmdb: { success: 0, failed: 0 },
        wiki: { success: 0, failed: 0, tmdbFallback: 0, noContent: 0 },
        embeddings: { generated: 0, failed: 0 },
      },
    };
  }

  /**
   * Load existing progress from file
   * @returns {Object|null} - Loaded progress or null
   */
  load() {
    try {
      if (fs.existsSync(this.progressFile)) {
        const data = fs.readFileSync(this.progressFile, "utf-8");
        const progress = JSON.parse(data);
        console.log(`📂 Loaded existing progress: ${progress.processed}/${progress.totalItems} titles`);
        return progress;
      }
    } catch (error) {
      console.warn(`⚠️  Could not load progress file: ${error.message}`);
    }
    return null;
  }

  /**
   * Save current progress to file
   */
  save() {
    try {
      this.progress.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.progressFile, JSON.stringify(this.progress, null, 2));
    } catch (error) {
      console.error(`❌ Failed to save progress: ${error.message}`);
    }
  }

  /**
   * Update progress with new data
   * @param {Object} data - Data to merge into progress
   */
  update(data) {
    Object.assign(this.progress, data);

    // Calculate progress percentage
    this.progress.progressPercent = parseFloat(
      ((this.progress.processed / this.progress.totalItems) * 100).toFixed(1)
    );

    // Estimate completion time
    if (this.progress.processed > 0) {
      const elapsed = Date.now() - this.startTime;
      const rate = elapsed / this.progress.processed;
      const remaining = this.progress.totalItems - this.progress.processed;
      const eta = new Date(Date.now() + rate * remaining);
      this.progress.estimatedCompletion = eta.toISOString();
    }

    this.save();
  }

  /**
   * Increment a counter
   * @param {string} field - Field name to increment
   * @param {number} count - Amount to increment by
   */
  increment(field, count = 1) {
    if (this.progress[field] !== undefined) {
      this.progress[field] += count;
    }
  }

  /**
   * Increment nested stats counter
   * @param {string} category - Stats category (tmdb, wiki, embeddings)
   * @param {string} field - Field name within category
   * @param {number} count - Amount to increment by
   */
  incrementStat(category, field, count = 1) {
    if (this.progress.stats[category]?.[field] !== undefined) {
      this.progress.stats[category][field] += count;
    }
  }

  /**
   * Mark a title as processed
   * @param {number} titleId - ID of processed title
   */
  markProcessed(titleId) {
    if (!this.progress.processedIds.includes(titleId)) {
      this.progress.processedIds.push(titleId);
      this.progress.processed = this.progress.processedIds.length;
    }
  }

  /**
   * Check if a title has been processed
   * @param {number} titleId - ID to check
   * @returns {boolean}
   */
  isProcessed(titleId) {
    return this.progress.processedIds.includes(titleId);
  }

  /**
   * Set checkpoint for resume functionality
   * @param {number} index - Current index in processing loop
   */
  setCheckpoint(index) {
    this.progress.checkpoint = index;
    this.save();
  }

  /**
   * Get last checkpoint
   * @returns {number|null} - Last checkpoint index or null
   */
  getCheckpoint() {
    return this.progress.checkpoint;
  }

  /**
   * Get list of processed IDs (for skipping on resume)
   * @returns {number[]} - Array of processed title IDs
   */
  getProcessedIds() {
    return this.progress.processedIds || [];
  }

  /**
   * Get stats object
   * @returns {Object} - Stats object
   */
  getStats() {
    return this.progress.stats;
  }

  /**
   * Generate ASCII progress bar
   * @param {number} percent - Progress percentage
   * @param {number} width - Bar width in characters
   * @returns {string} - ASCII progress bar
   */
  generateProgressBar(percent, width = 40) {
    const filled = Math.floor((percent / 100) * width);
    const empty = width - filled;
    return "█".repeat(filled) + "░".repeat(empty);
  }

  /**
   * Print progress to console
   */
  print() {
    const percent = this.progress.progressPercent;
    const bar = this.generateProgressBar(percent);

    console.log(`\n📊 Progress: ${bar} ${percent}%`);
    console.log(`   Processed: ${this.progress.processed}/${this.progress.totalItems}`);
    console.log(
      `   ✅ Success: ${this.progress.success} | ❌ Failed: ${this.progress.failed} | ⏭️  Skipped: ${this.progress.skipped}`
    );

    if (this.progress.estimatedCompletion) {
      const eta = new Date(this.progress.estimatedCompletion);
      const now = new Date();
      const remaining = Math.max(0, eta - now);
      const minutes = Math.floor(remaining / 60000);
      const hours = Math.floor(minutes / 60);

      if (hours > 0) {
        console.log(`   ⏱️  ETA: ${hours}h ${minutes % 60}m`);
      } else if (minutes > 0) {
        console.log(`   ⏱️  ETA: ${minutes}m`);
      } else {
        console.log(`   ⏱️  ETA: <1m`);
      }
    }
  }

  /**
   * Print inline progress (single line, overwrites)
   * @param {number} current - Current item number
   * @param {string} label - Optional label
   */
  printInline(current, label = "") {
    const percent = ((current / this.progress.totalItems) * 100).toFixed(1);
    const bar = this.generateProgressBar(parseFloat(percent), 30);
    process.stdout.write(`\r${label} ${bar} ${percent}% (${current}/${this.progress.totalItems})`);
  }

  /**
   * Print final summary
   */
  printSummary() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const durationMinutes = (duration / 60).toFixed(1);

    console.log("\n" + "━".repeat(60));
    console.log(`✨ ${this.phaseName.toUpperCase()} COMPLETE`);
    console.log("━".repeat(60));
    console.log(`📊 Titles processed: ${this.progress.processed}`);
    console.log("");
    console.log("TMDB Enrichment:");
    console.log(`  ✓ Success: ${this.progress.stats.tmdb.success}`);
    console.log(`  ✗ Failed: ${this.progress.stats.tmdb.failed}`);
    console.log("");
    console.log("Wikipedia/Vibe Enrichment:");
    console.log(`  ✓ Wikipedia: ${this.progress.stats.wiki.success}`);
    console.log(`  ✓ TMDB fallback: ${this.progress.stats.wiki.tmdbFallback}`);
    console.log(`  ⚠️  No content: ${this.progress.stats.wiki.noContent}`);
    console.log(`  ✗ Failed: ${this.progress.stats.wiki.failed}`);
    console.log("");
    console.log("Embeddings:");
    console.log(`  ✓ Generated: ${this.progress.stats.embeddings.generated}`);
    console.log(`  ✗ Failed: ${this.progress.stats.embeddings.failed}`);
    console.log("");
    console.log(`⏱️  Duration: ${durationMinutes}m (${duration}s)`);

    if (this.progress.processed > 0) {
      const successRate =
        (this.progress.success / this.progress.processed) * 100;
      console.log(`📈 Success rate: ${successRate.toFixed(1)}%`);
    }

    console.log("━".repeat(60) + "\n");
  }

  /**
   * Clear progress file (for fresh start)
   */
  clear() {
    try {
      if (fs.existsSync(this.progressFile)) {
        fs.unlinkSync(this.progressFile);
        console.log(`🗑️  Cleared progress file: ${this.progressFile}`);
      }
      this.progress = this.createInitialProgress();
    } catch (error) {
      console.error(`❌ Failed to clear progress: ${error.message}`);
    }
  }

  /**
   * Check if there's existing progress to resume
   * @returns {boolean}
   */
  hasExistingProgress() {
    return fs.existsSync(this.progressFile) && this.progress.processed > 0;
  }
}

/**
 * Calculate time estimates
 * @param {number} processed - Items processed so far
 * @param {number} total - Total items
 * @param {number} startTime - Start timestamp
 * @returns {Object|null} - ETA info or null
 */
export function calculateETA(processed, total, startTime) {
  if (processed === 0) return null;

  const elapsed = Date.now() - startTime;
  const rate = elapsed / processed;
  const remaining = total - processed;
  const eta = new Date(Date.now() + rate * remaining);

  return {
    eta,
    remainingMs: rate * remaining,
    remainingMinutes: Math.floor((rate * remaining) / 60000),
    remainingHours: Math.floor((rate * remaining) / 3600000),
  };
}

export default ProgressTracker;

