/**
 * Wikipedia content fetcher with strict validation
 * CRITICAL: This fixes the bug where wrong articles were being matched
 */

import { config } from "../config.js";
import { retry } from "../lib/retry.js";
import { createLogger } from "../lib/logger.js";
import { validateArticle, isObviouslyWrong } from "./validator.js";
import { generateTitleVariations } from "./title-normalizer.js";

const log = createLogger("[Wiki]");

// Roman numeral conversion for pattern generation
const ROMAN_TO_ARABIC = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5",
  vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
  xi: "11", xii: "12", xiii: "13", xiv: "14", xv: "15",
  xvi: "16", xvii: "17", xviii: "18", xix: "19", xx: "20",
};

/**
 * Convert Roman numerals to Arabic in a string
 * @param {string} text
 * @returns {string}
 */
function convertRomanNumerals(text) {
  return text.replace(
    /\b((?:x{0,2}(?:ix|iv|v?i{0,3})|x{1,2}(?:ix|iv|v?i{0,3})?))(?=\s|$|:|-|\))/gi,
    (match) => ROMAN_TO_ARABIC[match.toLowerCase()] || match
  );
}

/**
 * Wikipedia fetcher with validation
 */
export class WikipediaFetcher {
  /**
   * @param {import("../lib/rate-limiter.js").RateLimiter} rateLimiter
   */
  constructor(rateLimiter) {
    this.rateLimiter = rateLimiter;
    this.baseUrl = config.wikipedia.baseUrl;
    this.searchUrl = config.wikipedia.searchUrl;
    this.minConfidence = config.wikipedia.minConfidence;
  }

  /**
   * Generate title patterns to try
   * Uses comprehensive normalization for better Wikipedia matching
   * @param {string} title - Movie/TV title
   * @param {string} year - Release year
   * @param {"movie"|"tv"} kind
   * @returns {string[]}
   */
  generateTitlePatterns(title, year, kind) {
    const patterns = new Set();

    // Clean title - preserve colons, commas, and other punctuation common in titles
    const cleanTitle = title.replace(/[^\w\s:',!?&.-]/g, "").trim();
    patterns.add(cleanTitle);

    // Expand common abbreviations (Vol. → Volume, Pt. → Part, etc.)
    const expandedTitle = cleanTitle
      .replace(/\bVol\.\s*/gi, "Volume ")
      .replace(/\bPt\.\s*/gi, "Part ")
      .replace(/\bEp\.\s*/gi, "Episode ")
      .replace(/\bMr\.\s*/gi, "Mister ")
      .replace(/\bDr\.\s*/gi, "Doctor ")
      .replace(/\bSt\.\s*/gi, "Saint ")
      .replace(/\bBros\.\s*/gi, "Brothers ")
      .replace(/\bVs\.\s*/gi, "Versus ")
      .trim();
    if (expandedTitle !== cleanTitle) {
      patterns.add(expandedTitle);
    }

    // Convert Roman numerals to Arabic (e.g., "Rocky III" → "Rocky 3")
    const arabicTitle = convertRomanNumerals(cleanTitle);
    if (arabicTitle !== cleanTitle) {
      patterns.add(arabicTitle);
    }

    // Expanded + Arabic numerals
    const expandedArabic = convertRomanNumerals(expandedTitle);
    if (expandedArabic !== expandedTitle && expandedArabic !== cleanTitle) {
      patterns.add(expandedArabic);
    }

    // Try without colons (some Wikipedia articles don't have them)
    const noColonTitle = cleanTitle.replace(/:/g, "").replace(/\s+/g, " ").trim();
    if (noColonTitle !== cleanTitle) {
      patterns.add(noColonTitle);
    }

    // Ampersand variations
    if (cleanTitle.includes("&")) {
      patterns.add(cleanTitle.replace(/\s*&\s*/g, " and "));
    }
    if (cleanTitle.toLowerCase().includes(" and ")) {
      patterns.add(cleanTitle.replace(/\s+and\s+/gi, " & "));
    }

    // Build final patterns array with disambiguators
    const result = [...patterns];

    // Add disambiguated versions (most specific first)
    if (kind === "movie") {
      result.push(`${cleanTitle} (${year} film)`);
      result.push(`${cleanTitle} (film)`);
      if (expandedTitle !== cleanTitle) {
        result.push(`${expandedTitle} (${year} film)`);
        result.push(`${expandedTitle} (film)`);
      }
    } else {
      // For TV, try year-specific first (handles shows with multiple versions like Dallas)
      result.push(`${cleanTitle} (${year} TV series)`);
      result.push(`${cleanTitle} (TV series)`);
      result.push(`${cleanTitle} (miniseries)`);
      result.push(`${cleanTitle} (American TV series)`);
      result.push(`${cleanTitle} (British TV series)`);
      result.push(`${cleanTitle} (Australian TV series)`);
      result.push(`${cleanTitle} (Canadian TV series)`);
      result.push(`${cleanTitle} (animated series)`);
      result.push(`${cleanTitle} (${year} animated series)`);
    }

    // With year only
    result.push(`${cleanTitle} (${year})`);

    // Deduplicate while preserving order
    return [...new Set(result)];
  }

  /**
   * Fetch article by title (direct fetch)
   * @param {string} title - Wikipedia article title
   * @returns {Promise<Object|null>}
   */
  async fetchArticle(title) {
    await this.rateLimiter.acquire();

    const encodedTitle = encodeURIComponent(title.replace(/ /g, "_"));
    const url = `${this.baseUrl}/page/summary/${encodedTitle}`;

    try {
      const response = await retry(
        async () => {
          const res = await fetch(url, {
            headers: {
              Accept: "application/json",
              "User-Agent": "MediaRecommendationSystem/1.0 (https://github.com/example; contact@example.com)",
            },
          });

          if (res.status === 404) {
            return null;
          }

          if (!res.ok) {
            const error = new Error(`Wikipedia API error: ${res.status}`);
            error.status = res.status;
            throw error;
          }

          return res.json();
        },
        { maxRetries: 2 }
      );

      if (!response) return null;

      // Get full content for better validation
      const content = await this.fetchFullContent(title);

      return {
        title: response.title,
        extract: response.extract || "",
        content: content || response.extract || "",
        url: response.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodedTitle}`,
      };
    } catch (error) {
      log.debug(`Failed to fetch article: ${title}`, { error: error.message });
      return null;
    }
  }

  /**
   * Fetch full article content for better validation
   * @param {string} title
   * @returns {Promise<string|null>}
   */
  async fetchFullContent(title) {
    await this.rateLimiter.acquire();

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
      const response = await fetch(`${this.searchUrl}?${params}`, { headers });
      if (!response.ok) return null;

      const data = await response.json();
      const pages = data.query?.pages;
      if (!pages) return null;

      const page = Object.values(pages)[0];
      return page?.extract || null;
    } catch {
      return null;
    }
  }

  /**
   * Search Wikipedia for a title
   * @param {string} query - Search query
   * @returns {Promise<string[]>} - List of potential article titles
   */
  async searchWikipedia(query) {
    await this.rateLimiter.acquire();

    const params = new URLSearchParams({
      action: "opensearch",
      search: query,
      limit: "5",
      namespace: "0",
      format: "json",
      origin: "*",
    });

    const headers = {
      "User-Agent": "MediaRecommendationSystem/1.0 (https://github.com/example; contact@example.com)",
    };

    try {
      const response = await fetch(`${this.searchUrl}?${params}`, { headers });
      if (!response.ok) return [];

      const data = await response.json();
      // OpenSearch returns [query, titles, descriptions, urls]
      return data[1] || [];
    } catch {
      return [];
    }
  }

  /**
   * Fetch Wikipedia content for a title with strict validation
   * @param {string} title - Movie/TV title
   * @param {string} year - Release year (YYYY format)
   * @param {"movie"|"tv"} kind - Type of title
   * @param {Object} tmdbData - TMDB data for cross-reference
   * @returns {Promise<{content: string, url: string, confidence: number}|null>}
   */
  async fetchForTitle(title, year, kind, tmdbData = {}) {
    const patterns = this.generateTitlePatterns(title, year, kind);

    // Step 1: Try direct fetch with each pattern
    for (const pattern of patterns) {
      log.debug(`Trying direct fetch: ${pattern}`);

      const article = await this.fetchArticle(pattern);
      if (!article) continue;

      // Quick rejection for obviously wrong articles
      if (isObviouslyWrong(article.extract)) {
        log.debug(`Rejected (obviously wrong): ${pattern}`);
        continue;
      }

      // Validate article
      const validation = validateArticle(article, title, year, kind, tmdbData);

      if (validation.isValid) {
        log.info(`Found valid article: ${article.title}`, {
          confidence: validation.confidence,
          reasons: validation.reasons,
        });

        return {
          content: article.content,
          url: article.url,
          confidence: validation.confidence,
        };
      }

      log.debug(`Rejected (low confidence): ${pattern}`, {
        confidence: validation.confidence,
        reasons: validation.reasons,
      });
    }

    // Step 2: Try search as fallback
    const searchQuery = `${title} ${year} ${kind === "movie" ? "film" : "TV series"}`;
    log.debug(`Searching: ${searchQuery}`);

    const searchResults = await this.searchWikipedia(searchQuery);

    for (const resultTitle of searchResults) {
      // Skip if we already tried this pattern
      const normalizedResult = resultTitle.toLowerCase();
      const alreadyTried = patterns.some((p) => p.toLowerCase() === normalizedResult);
      if (alreadyTried) continue;

      log.debug(`Trying search result: ${resultTitle}`);

      const article = await this.fetchArticle(resultTitle);
      if (!article) continue;

      // Quick rejection
      if (isObviouslyWrong(article.extract)) {
        log.debug(`Rejected search result (obviously wrong): ${resultTitle}`);
        continue;
      }

      // Validate article
      const validation = validateArticle(article, title, year, kind, tmdbData);

      if (validation.isValid) {
        log.info(`Found valid article via search: ${article.title}`, {
          confidence: validation.confidence,
          reasons: validation.reasons,
        });

        return {
          content: article.content,
          url: article.url,
          confidence: validation.confidence,
        };
      }

      log.debug(`Rejected search result: ${resultTitle}`, {
        confidence: validation.confidence,
        reasons: validation.reasons,
      });
    }

    log.info(`No valid Wikipedia article found for: ${title} (${year})`);
    return null;
  }
}

/**
 * Create a Wikipedia fetcher with default rate limiter
 * @param {import("../lib/rate-limiter.js").RateLimiter} rateLimiter
 * @returns {WikipediaFetcher}
 */
export function createWikipediaFetcher(rateLimiter) {
  return new WikipediaFetcher(rateLimiter);
}
