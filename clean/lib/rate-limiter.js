/**
 * Adaptive Rate Limiter with Token Bucket Algorithm
 * Self-contained utility for rate limiting API calls
 */

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limiter class with token bucket algorithm and adaptive backoff
 */
export class RateLimiter {
  /**
   * @param {Object} options - Rate limiter options
   * @param {number} options.delayMs - Base delay between requests
   * @param {number} options.maxRetries - Maximum retry attempts
   * @param {number} options.backoffMultiplier - Multiplier for exponential backoff
   * @param {string} options.name - Name for logging purposes
   */
  constructor(options = {}) {
    this.delayMs = options.delayMs || 500;
    this.maxRetries = options.maxRetries || 3;
    this.backoffMultiplier = options.backoffMultiplier || 2;
    this.name = options.name || "api";

    // Adaptive delay tracking
    this.adaptiveDelayMs = this.delayMs;
    this.consecutiveErrors = 0;
    this.lastRequestTime = 0;
  }

  /**
   * Wait for rate limit before making a request
   * Ensures minimum delay between requests
   */
  async acquire() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const waitTime = Math.max(0, this.adaptiveDelayMs - elapsed);

    if (waitTime > 0) {
      await delay(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Report a successful request (reduces adaptive delay)
   */
  reportSuccess() {
    this.consecutiveErrors = 0;

    // Gradually reduce adaptive delay back to baseline
    if (this.adaptiveDelayMs > this.delayMs) {
      this.adaptiveDelayMs = Math.max(
        this.delayMs,
        this.adaptiveDelayMs * 0.9
      );
    }
  }

  /**
   * Report a rate limit error (increases adaptive delay)
   */
  reportRateLimit() {
    this.consecutiveErrors++;

    // Exponential backoff on rate limit errors
    this.adaptiveDelayMs = Math.min(
      10000, // Max 10 seconds
      this.adaptiveDelayMs * this.backoffMultiplier
    );

    console.warn(
      `⚠️  Rate limit hit on ${this.name}. Increasing delay to ${this.adaptiveDelayMs}ms`
    );
  }

  /**
   * Report a generic error (slight backoff)
   */
  reportError() {
    this.consecutiveErrors++;

    if (this.consecutiveErrors >= 3) {
      // After 3 consecutive errors, apply mild backoff
      this.adaptiveDelayMs = Math.min(
        5000,
        this.adaptiveDelayMs * 1.2
      );
    }
  }

  /**
   * Get current status
   * @returns {Object} - Current rate limiter status
   */
  getStatus() {
    return {
      name: this.name,
      baseDelayMs: this.delayMs,
      adaptiveDelayMs: this.adaptiveDelayMs,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  /**
   * Reset adaptive delay to baseline
   */
  reset() {
    this.adaptiveDelayMs = this.delayMs;
    this.consecutiveErrors = 0;
  }
}

/**
 * Retry wrapper with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} - Result of function
 */
export async function retryWithBackoff(
  fn,
  {
    maxRetries = 3,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    rateLimiter = null,
    onRetry = null,
  } = {}
) {
  let lastError;
  let delayMs = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Acquire rate limiter token if provided
      if (rateLimiter) {
        await rateLimiter.acquire();
      }

      const result = await fn();

      // Report success to rate limiter
      if (rateLimiter) {
        rateLimiter.reportSuccess();
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if it's a rate limit error
      const isRateLimit =
        error.message?.includes("429") ||
        error.message?.toLowerCase().includes("rate limit") ||
        error.response?.status === 429;

      if (rateLimiter) {
        if (isRateLimit) {
          rateLimiter.reportRateLimit();
        } else {
          rateLimiter.reportError();
        }
      }

      // If we've exhausted retries, throw
      if (attempt >= maxRetries) {
        throw lastError;
      }

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, maxRetries + 1, error);
      }

      // Exponential backoff
      await delay(delayMs);
      delayMs *= backoffMultiplier;
    }
  }

  throw lastError;
}

/**
 * Categorize error for logging purposes
 * @param {Error} error - Error object
 * @returns {string} - Error category
 */
export function categorizeError(error) {
  const message = (error.message || "").toLowerCase();
  const status = error.response?.status;

  if (message.includes("rate limit") || message.includes("429") || status === 429) {
    return "rate_limit";
  }
  if (message.includes("timeout") || error.code === "ECONNABORTED") {
    return "timeout";
  }
  if (message.includes("not found") || message.includes("404") || status === 404) {
    return "not_found";
  }
  if (message.includes("network") || message.includes("econnrefused") || message.includes("enotfound")) {
    return "network_error";
  }
  if (message.includes("parse") || message.includes("json")) {
    return "parse_error";
  }
  if (message.includes("auth") || message.includes("401") || status === 401) {
    return "auth_error";
  }
  if (message.includes("permission") || message.includes("403") || status === 403) {
    return "permission_error";
  }
  if (status >= 500) {
    return "server_error";
  }

  return "unknown_error";
}

export default RateLimiter;

