/**
 * Simple rate limiter using delay between requests
 */
export class RateLimiter {
  /**
   * @param {number} delayMs - Minimum delay between requests in milliseconds
   */
  constructor(delayMs) {
    this.delayMs = delayMs;
    this.lastRequest = 0;
  }

  /**
   * Wait until we're allowed to make another request
   * Call this before each request
   */
  async acquire() {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    const waitTime = Math.max(0, this.delayMs - elapsed);

    if (waitTime > 0) {
      await sleep(waitTime);
    }

    this.lastRequest = Date.now();
  }

  /**
   * Update the delay (useful for handling rate limit responses)
   * @param {number} delayMs - New delay in milliseconds
   */
  setDelay(delayMs) {
    this.delayMs = delayMs;
  }
}

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a rate limiter for TMDB API
 * @param {number} [delayMs=500] - Delay between requests
 * @returns {RateLimiter}
 */
export function createTMDBRateLimiter(delayMs = 500) {
  return new RateLimiter(delayMs);
}

/**
 * Create a rate limiter for Wikipedia API
 * @param {number} [delayMs=200] - Delay between requests
 * @returns {RateLimiter}
 */
export function createWikipediaRateLimiter(delayMs = 200) {
  return new RateLimiter(delayMs);
}

/**
 * Create a rate limiter for OpenAI API
 * @param {number} [delayMs=100] - Delay between requests
 * @returns {RateLimiter}
 */
export function createOpenAIRateLimiter(delayMs = 100) {
  return new RateLimiter(delayMs);
}
