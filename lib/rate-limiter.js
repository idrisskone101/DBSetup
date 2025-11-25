// Adaptive rate limiter with backoff for API calls
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

/**
 * Rate limiter class with token bucket algorithm
 */
export class RateLimiter {
  constructor(api) {
    this.api = api;
    this.config = config.rate_limits[api];

    if (!this.config) {
      throw new Error(`Unknown API: ${api}`);
    }

    this.tokens = this.config.requests_per_second;
    this.maxTokens = this.config.requests_per_second;
    this.refillRate = this.config.requests_per_second;
    this.lastRefill = Date.now();
    this.consecutiveErrors = 0;
    this.adaptiveDelayMs = this.config.delay_ms;
  }

  /**
   * Wait until a token is available (rate limiting)
   */
  async acquire() {
    // Refill tokens based on elapsed time
    this.refillTokens();

    // If no tokens available, wait until next refill
    while (this.tokens < 1) {
      await this.sleep(100); // Check every 100ms
      this.refillTokens();
    }

    // Consume a token
    this.tokens -= 1;

    // Wait for the configured delay (plus any adaptive backoff)
    await this.sleep(this.adaptiveDelayMs);
  }

  /**
   * Refill tokens based on time elapsed
   */
  refillTokens() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = (elapsed / 1000) * this.refillRate;

    if (tokensToAdd >= 1) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Report a successful request (reduces adaptive delay)
   */
  reportSuccess() {
    this.consecutiveErrors = 0;

    // Gradually reduce adaptive delay back to baseline
    if (this.adaptiveDelayMs > this.config.delay_ms) {
      this.adaptiveDelayMs = Math.max(
        this.config.delay_ms,
        this.adaptiveDelayMs * 0.9,
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
      this.adaptiveDelayMs * this.config.backoff_multiplier,
    );

    console.warn(
      `⚠️  Rate limit hit on ${this.api}. Increasing delay to ${this.adaptiveDelayMs}ms`,
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
        this.adaptiveDelayMs * 1.2,
      );
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      api: this.api,
      tokens: this.tokens.toFixed(2),
      maxTokens: this.maxTokens,
      adaptiveDelayMs: this.adaptiveDelayMs,
      consecutiveErrors: this.consecutiveErrors,
    };
  }
}

/**
 * Global rate limiter instances (singleton pattern)
 */
const limiters = {};

/**
 * Get or create a rate limiter for an API
 * @param {string} api - API name ('tmdb', 'wikipedia', 'openai')
 * @returns {RateLimiter}
 */
export function getRateLimiter(api) {
  if (!limiters[api]) {
    limiters[api] = new RateLimiter(api);
  }
  return limiters[api];
}

/**
 * Simple delay utility for use outside rate limiter
 * @param {number} ms - Milliseconds to delay
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  } = {},
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
        error.message.includes("429") ||
        error.message.toLowerCase().includes("rate limit");

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

      // Exponential backoff
      console.warn(
        `⚠️  Attempt ${attempt + 1}/${maxRetries + 1} failed: ${error.message}. Retrying in ${delayMs}ms...`,
      );
      await delay(delayMs);
      delayMs *= backoffMultiplier;
    }
  }

  throw lastError;
}

/**
 * Batch processor with rate limiting
 * @param {Array} items - Items to process
 * @param {Function} processFn - Async function to process each item
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - { success: [], failed: [] }
 */
export async function processBatchWithRateLimit(
  items,
  processFn,
  { batchSize = 10, rateLimiter = null, onProgress = null } = {},
) {
  const results = {
    success: [],
    failed: [],
  };

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    // Process batch in parallel
    const batchResults = await Promise.allSettled(
      batch.map(async (item) => {
        if (rateLimiter) {
          await rateLimiter.acquire();
        }

        try {
          const result = await processFn(item);
          if (rateLimiter) {
            rateLimiter.reportSuccess();
          }
          return { item, result, success: true };
        } catch (error) {
          if (rateLimiter) {
            const isRateLimit =
              error.message.includes("429") ||
              error.message.toLowerCase().includes("rate limit");
            if (isRateLimit) {
              rateLimiter.reportRateLimit();
            } else {
              rateLimiter.reportError();
            }
          }
          return { item, error, success: false };
        }
      }),
    );

    // Categorize results
    batchResults.forEach((result) => {
      if (result.status === "fulfilled" && result.value.success) {
        results.success.push(result.value);
      } else {
        results.failed.push(result.value || result.reason);
      }
    });

    // Call progress callback
    if (onProgress) {
      onProgress({
        processed: Math.min(i + batchSize, items.length),
        total: items.length,
        success: results.success.length,
        failed: results.failed.length,
      });
    }
  }

  return results;
}
