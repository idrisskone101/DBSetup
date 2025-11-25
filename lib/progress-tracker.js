// JSON-based progress tracking system for long-running operations
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
const config = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "scaling-config.json"),
    "utf-8",
  ),
);

const LOG_DIR = path.join(__dirname, "..", config.logging.log_directory);

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Progress tracker class for managing JSON log files
 */
export class ProgressTracker {
  constructor(phase, totalItems) {
    this.phase = phase;
    this.totalItems = totalItems;
    this.logFile = path.join(LOG_DIR, `${phase}-progress.json`);

    // Initialize or load existing progress
    this.progress = this.load() || {
      phase,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      total_items: totalItems,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      current_batch: 0,
      total_batches: 0,
      progress_percent: 0,
      estimated_completion: null,
      errors_summary: {},
      last_checkpoint: null,
    };

    this.startTime = Date.now();
  }

  /**
   * Load existing progress from file
   */
  load() {
    try {
      if (fs.existsSync(this.logFile)) {
        const data = fs.readFileSync(this.logFile, "utf-8");
        return JSON.parse(data);
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
      this.progress.updated_at = new Date().toISOString();
      fs.writeFileSync(this.logFile, JSON.stringify(this.progress, null, 2));
    } catch (error) {
      console.error(`❌ Failed to save progress: ${error.message}`);
    }
  }

  /**
   * Update progress with new data
   */
  update(data) {
    Object.assign(this.progress, data);

    // Calculate progress percentage
    this.progress.progress_percent = (
      (this.progress.processed / this.progress.total_items) *
      100
    ).toFixed(1);

    // Estimate completion time
    if (this.progress.processed > 0) {
      const elapsed = Date.now() - this.startTime;
      const rate = elapsed / this.progress.processed;
      const remaining = this.progress.total_items - this.progress.processed;
      const eta = new Date(Date.now() + rate * remaining);
      this.progress.estimated_completion = eta.toISOString();
    }

    this.save();
  }

  /**
   * Increment counters
   */
  increment(type, count = 1) {
    if (this.progress[type] !== undefined) {
      this.progress[type] += count;
      this.progress.processed = Math.min(
        this.progress.success +
          this.progress.failed +
          this.progress.skipped,
        this.progress.total_items,
      );
      this.update({});
    }
  }

  /**
   * Add error to summary
   */
  addError(errorType) {
    if (!this.progress.errors_summary[errorType]) {
      this.progress.errors_summary[errorType] = 0;
    }
    this.progress.errors_summary[errorType]++;
    this.save();
  }

  /**
   * Set checkpoint for resume functionality
   */
  setCheckpoint(checkpoint) {
    this.progress.last_checkpoint = checkpoint;
    this.save();
  }

  /**
   * Get last checkpoint
   */
  getCheckpoint() {
    return this.progress.last_checkpoint;
  }

  /**
   * Print progress to console
   */
  print() {
    const percent = this.progress.progress_percent;
    const bar = this.generateProgressBar(parseFloat(percent));

    console.log(`\n📊 Progress: ${bar} ${percent}%`);
    console.log(
      `   Processed: ${this.progress.processed}/${this.progress.total_items}`,
    );
    console.log(
      `   ✅ Success: ${this.progress.success} | ❌ Failed: ${this.progress.failed} | ⏭️  Skipped: ${this.progress.skipped}`,
    );

    if (this.progress.estimated_completion) {
      const eta = new Date(this.progress.estimated_completion);
      const now = new Date();
      const remaining = Math.max(0, eta - now);
      const minutes = Math.floor(remaining / 60000);
      const hours = Math.floor(minutes / 60);

      if (hours > 0) {
        console.log(`   ⏱️  ETA: ${hours}h ${minutes % 60}m`);
      } else {
        console.log(`   ⏱️  ETA: ${minutes}m`);
      }
    }
  }

  /**
   * Generate ASCII progress bar
   */
  generateProgressBar(percent, width = 40) {
    const filled = Math.floor((percent / 100) * width);
    const empty = width - filled;
    return "█".repeat(filled) + "░".repeat(empty);
  }

  /**
   * Print final summary
   */
  printSummary() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const durationMinutes = (duration / 60).toFixed(1);

    console.log("\n" + "━".repeat(60));
    console.log(`✨ ${this.phase.toUpperCase()} COMPLETE`);
    console.log("━".repeat(60));
    console.log(`✅ Successfully processed: ${this.progress.success}`);
    console.log(`⏭️  Skipped: ${this.progress.skipped}`);
    console.log(`❌ Failed: ${this.progress.failed}`);
    console.log(`⏱️  Duration: ${durationMinutes}m (${duration}s)`);

    if (this.progress.success + this.progress.failed > 0) {
      const successRate =
        (this.progress.success /
          (this.progress.success + this.progress.failed)) *
        100;
      console.log(`📈 Success rate: ${successRate.toFixed(1)}%`);
    }

    // Print error summary if there are errors
    if (Object.keys(this.progress.errors_summary).length > 0) {
      console.log("\n❌ Error Summary:");
      Object.entries(this.progress.errors_summary)
        .sort(([, a], [, b]) => b - a)
        .forEach(([type, count]) => {
          console.log(`   ${type}: ${count}`);
        });
    }

    console.log("━".repeat(60) + "\n");
  }

  /**
   * Check if progress should be saved (based on frequency)
   */
  shouldUpdate(currentItem) {
    return currentItem % config.logging.progress_update_frequency === 0;
  }
}

/**
 * Simple progress bar for quick operations
 */
export function printProgressBar(current, total, label = "") {
  const percent = ((current / total) * 100).toFixed(1);
  const width = 40;
  const filled = Math.floor((current / total) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  process.stdout.write(`\r${label} ${bar} ${percent}% (${current}/${total})`);

  if (current === total) {
    process.stdout.write("\n");
  }
}

/**
 * Calculate time estimates
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
