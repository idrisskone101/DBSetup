// Database-backed failure logging for debugging and retry logic
import { supabase } from "../supabase-upsert.js";

/**
 * Failure logger class for database-backed error tracking
 */
export class FailureLogger {
  constructor(phase) {
    this.phase = phase;
  }

  /**
   * Log a failure to the database
   * @param {number} titleId - ID of the failed title
   * @param {string} errorType - Type/category of error
   * @param {string} errorMessage - Detailed error message
   * @param {number} retryCount - Current retry attempt number
   */
  async logFailure(titleId, errorType, errorMessage, retryCount = 0) {
    try {
      const { error } = await supabase.from("enrichment_failures").insert({
        title_id: titleId,
        phase: this.phase,
        error_type: errorType,
        error_message: errorMessage,
        retry_count: retryCount,
        last_attempt_at: new Date().toISOString(),
        resolved: false,
      });

      if (error) {
        console.error(
          `⚠️  Failed to log error to database: ${error.message}`,
        );
      }
    } catch (err) {
      console.error(`⚠️  Exception logging failure: ${err.message}`);
    }
  }

  /**
   * Update existing failure with retry information
   * @param {number} titleId - ID of the title
   * @param {number} retryCount - New retry count
   * @param {string} errorMessage - Updated error message (optional)
   */
  async updateFailure(titleId, retryCount, errorMessage = null) {
    try {
      const updateData = {
        retry_count: retryCount,
        last_attempt_at: new Date().toISOString(),
      };

      if (errorMessage) {
        updateData.error_message = errorMessage;
      }

      const { error } = await supabase
        .from("enrichment_failures")
        .update(updateData)
        .eq("title_id", titleId)
        .eq("phase", this.phase)
        .eq("resolved", false);

      if (error) {
        console.error(
          `⚠️  Failed to update failure log: ${error.message}`,
        );
      }
    } catch (err) {
      console.error(`⚠️  Exception updating failure: ${err.message}`);
    }
  }

  /**
   * Mark a failure as resolved
   * @param {number} titleId - ID of the title
   */
  async markResolved(titleId) {
    try {
      const { error } = await supabase
        .from("enrichment_failures")
        .update({ resolved: true })
        .eq("title_id", titleId)
        .eq("phase", this.phase)
        .eq("resolved", false);

      if (error) {
        console.error(
          `⚠️  Failed to mark failure as resolved: ${error.message}`,
        );
      }
    } catch (err) {
      console.error(`⚠️  Exception marking resolved: ${err.message}`);
    }
  }

  /**
   * Get all unresolved failures for this phase
   * @returns {Promise<Array>} - Array of failure records
   */
  async getUnresolvedFailures() {
    try {
      const { data, error } = await supabase
        .from("enrichment_failures")
        .select("*")
        .eq("phase", this.phase)
        .eq("resolved", false)
        .order("retry_count", { ascending: false });

      if (error) {
        console.error(`⚠️  Failed to fetch failures: ${error.message}`);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error(`⚠️  Exception fetching failures: ${err.message}`);
      return [];
    }
  }

  /**
   * Get failure count by error type
   * @returns {Promise<Object>} - { error_type: count }
   */
  async getFailureStats() {
    try {
      const { data, error } = await supabase
        .from("enrichment_failures")
        .select("error_type")
        .eq("phase", this.phase)
        .eq("resolved", false);

      if (error) {
        console.error(`⚠️  Failed to fetch failure stats: ${error.message}`);
        return {};
      }

      const stats = {};
      (data || []).forEach((row) => {
        stats[row.error_type] = (stats[row.error_type] || 0) + 1;
      });

      return stats;
    } catch (err) {
      console.error(`⚠️  Exception fetching stats: ${err.message}`);
      return {};
    }
  }

  /**
   * Get titles that should be retried (retry_count < max)
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<Array>} - Array of title IDs to retry
   */
  async getTitlesToRetry(maxRetries = 3) {
    try {
      const { data, error } = await supabase
        .from("enrichment_failures")
        .select("title_id, retry_count")
        .eq("phase", this.phase)
        .eq("resolved", false)
        .lt("retry_count", maxRetries);

      if (error) {
        console.error(`⚠️  Failed to fetch retry candidates: ${error.message}`);
        return [];
      }

      return (data || []).map((row) => row.title_id);
    } catch (err) {
      console.error(`⚠️  Exception fetching retry candidates: ${err.message}`);
      return [];
    }
  }

  /**
   * Clean up old resolved failures (optional maintenance)
   * @param {number} daysOld - Delete resolved failures older than N days
   */
  async cleanupOldFailures(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { error } = await supabase
        .from("enrichment_failures")
        .delete()
        .eq("phase", this.phase)
        .eq("resolved", true)
        .lt("last_attempt_at", cutoffDate.toISOString());

      if (error) {
        console.error(`⚠️  Failed to cleanup old failures: ${error.message}`);
      } else {
        console.log(
          `✅ Cleaned up resolved failures older than ${daysOld} days`,
        );
      }
    } catch (err) {
      console.error(`⚠️  Exception cleaning up failures: ${err.message}`);
    }
  }
}

/**
 * Helper function to categorize errors
 * @param {Error} error - Error object
 * @returns {string} - Error category
 */
export function categorizeError(error) {
  const message = error.message.toLowerCase();

  if (message.includes("rate limit") || message.includes("429")) {
    return "rate_limit";
  }
  if (message.includes("timeout")) {
    return "timeout";
  }
  if (message.includes("not found") || message.includes("404")) {
    return "not_found";
  }
  if (message.includes("network") || message.includes("econnrefused")) {
    return "network_error";
  }
  if (message.includes("parse") || message.includes("json")) {
    return "parse_error";
  }
  if (message.includes("auth") || message.includes("401")) {
    return "authentication_error";
  }
  if (message.includes("permission") || message.includes("403")) {
    return "permission_error";
  }

  return "unknown_error";
}

/**
 * Retry wrapper with failure logging
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} - Result of function or throws last error
 */
export async function retryWithLogging(
  fn,
  { maxRetries = 3, delayMs = 1000, logger = null, titleId = null, backoffMultiplier = 2 } = {},
) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();

      // If successful after retries, mark as resolved
      if (attempt > 0 && logger && titleId) {
        await logger.markResolved(titleId);
      }

      return result;
    } catch (error) {
      lastError = error;
      const errorType = categorizeError(error);

      if (logger && titleId) {
        if (attempt === 0) {
          await logger.logFailure(titleId, errorType, error.message, attempt);
        } else {
          await logger.updateFailure(titleId, attempt, error.message);
        }
      }

      if (attempt < maxRetries) {
        const delay = delayMs * Math.pow(backoffMultiplier, attempt);
        console.warn(
          `⚠️  Attempt ${attempt + 1}/${maxRetries + 1} failed: ${error.message}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
