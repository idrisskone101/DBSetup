import { sleep } from "./rate-limiter.js";

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options
 * @param {number} [options.maxRetries=3] - Maximum number of retries
 * @param {number} [options.initialDelay=1000] - Initial delay in ms
 * @param {number} [options.maxDelay=30000] - Maximum delay in ms
 * @param {Function} [options.shouldRetry] - Function to determine if error is retryable
 * @param {Function} [options.onRetry] - Callback when retrying
 * @returns {Promise<*>} - Result of the function
 */
export async function retry(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    shouldRetry = defaultShouldRetry,
    onRetry = () => {},
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Handle rate limit responses
      const retryAfter = getRetryAfter(error);
      const waitTime = retryAfter || delay;

      onRetry(error, attempt + 1, waitTime);

      await sleep(waitTime);

      // Exponential backoff for next attempt
      delay = Math.min(delay * 2, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Default function to determine if an error is retryable
 * @param {Error} error
 * @returns {boolean}
 */
function defaultShouldRetry(error) {
  // Network errors
  if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
    return true;
  }

  // HTTP status codes
  const status = error.response?.status || error.status;
  if (status) {
    // 429 Too Many Requests
    if (status === 429) return true;
    // 5xx Server Errors
    if (status >= 500 && status < 600) return true;
  }

  // Don't retry 4xx client errors (except 429)
  if (status >= 400 && status < 500) return false;

  return false;
}

/**
 * Extract retry-after value from error response
 * @param {Error} error
 * @returns {number|null} - Delay in ms, or null if not present
 */
function getRetryAfter(error) {
  const retryAfter = error.response?.headers?.["retry-after"];

  if (!retryAfter) return null;

  // If it's a number, treat as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // If it's a date, calculate delay
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

/**
 * Check if an error is a "not found" error (should not retry)
 * @param {Error} error
 * @returns {boolean}
 */
export function isNotFoundError(error) {
  const status = error.response?.status || error.status;
  return status === 404;
}

/**
 * Check if an error is a rate limit error
 * @param {Error} error
 * @returns {boolean}
 */
export function isRateLimitError(error) {
  const status = error.response?.status || error.status;
  return status === 429;
}
