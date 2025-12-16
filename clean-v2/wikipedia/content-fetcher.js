/**
 * Fetch Wikipedia content from existing URL
 * Used by repair pipeline to re-fetch content for titles with wiki_source_url
 */

import { config } from "../config.js";
import { retry } from "../lib/retry.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("[WikiContent]");

/**
 * Extract page title from Wikipedia URL
 * @param {string} url - Wikipedia URL (e.g., https://en.wikipedia.org/wiki/The_Matrix)
 * @returns {string|null} - Page title or null if invalid
 */
function extractTitleFromUrl(url) {
  if (!url) return null;

  try {
    const urlObj = new URL(url);

    // Handle /wiki/ URLs
    if (urlObj.pathname.startsWith("/wiki/")) {
      const title = urlObj.pathname.replace("/wiki/", "");
      return decodeURIComponent(title.replace(/_/g, " "));
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch full article content from Wikipedia
 * @param {string} title - Wikipedia article title
 * @param {import("../lib/rate-limiter.js").RateLimiter} [rateLimiter] - Optional rate limiter
 * @returns {Promise<string|null>}
 */
async function fetchArticleContent(title, rateLimiter) {
  if (rateLimiter) {
    await rateLimiter.acquire();
  }

  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "extracts",
    explaintext: "true",
    exsectionformat: "plain",
    format: "json",
    origin: "*",
  });

  const headers = {
    "User-Agent": "MediaRecommendationSystem/1.0 (https://github.com/example; contact@example.com)",
  };

  try {
    const response = await retry(
      async () => {
        const res = await fetch(`${config.wikipedia.searchUrl}?${params}`, { headers });
        if (!res.ok) {
          throw new Error(`Wikipedia API error: ${res.status}`);
        }
        return res.json();
      },
      { maxRetries: 2 }
    );

    const pages = response.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    if (!page || page.missing !== undefined) {
      log.debug(`Wikipedia page not found: ${title}`);
      return null;
    }

    return page.extract || null;
  } catch (error) {
    log.error(`Failed to fetch Wikipedia content for: ${title}`, { error: error.message });
    return null;
  }
}

/**
 * Fetch Wikipedia content from an existing URL
 * @param {string} url - Wikipedia URL stored in wiki_source_url
 * @param {import("../lib/rate-limiter.js").RateLimiter} [rateLimiter] - Optional rate limiter
 * @returns {Promise<string|null>}
 */
export async function fetchWikipediaContent(url, rateLimiter) {
  const title = extractTitleFromUrl(url);

  if (!title) {
    log.warn(`Could not extract title from URL: ${url}`);
    return null;
  }

  log.debug(`Fetching content for: ${title}`);
  return fetchArticleContent(title, rateLimiter);
}

/**
 * Batch fetch Wikipedia content for multiple URLs
 * @param {string[]} urls - Array of Wikipedia URLs
 * @param {import("../lib/rate-limiter.js").RateLimiter} rateLimiter
 * @returns {Promise<Map<string, string>>} - Map of URL to content
 */
export async function batchFetchWikipediaContent(urls, rateLimiter) {
  const results = new Map();

  for (const url of urls) {
    const content = await fetchWikipediaContent(url, rateLimiter);
    if (content) {
      results.set(url, content);
    }
  }

  return results;
}
