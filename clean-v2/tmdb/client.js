import { config, getTMDBToken } from "../config.js";
import { retry, isNotFoundError } from "../lib/retry.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("[TMDB]");

/**
 * TMDB API Client with retry and rate limiting
 */
export class TMDBClient {
  /**
   * @param {import("../lib/rate-limiter.js").RateLimiter} rateLimiter
   */
  constructor(rateLimiter) {
    this.token = getTMDBToken();
    this.baseUrl = config.tmdb.baseUrl;
    this.rateLimiter = rateLimiter;
  }

  /**
   * Make a request to the TMDB API
   * @param {string} endpoint - API endpoint (e.g., "/movie/123")
   * @param {Object} [params] - Query parameters
   * @returns {Promise<Object>}
   */
  async request(endpoint, params = {}) {
    await this.rateLimiter.acquire();

    const url = new URL(`${this.baseUrl}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });

    return retry(
      async () => {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(config.tmdb.timeout),
        });

        if (!response.ok) {
          const error = new Error(`TMDB API error: ${response.status}`);
          error.status = response.status;
          error.response = { status: response.status, headers: response.headers };
          throw error;
        }

        return response.json();
      },
      {
        maxRetries: config.tmdb.retries,
        onRetry: (error, attempt, waitTime) => {
          log.warn(`Retry ${attempt} after ${waitTime}ms`, { endpoint, error: error.message });
        },
      }
    );
  }

  /**
   * Get movie details with credits, keywords, etc.
   * @param {number} id - TMDB movie ID
   * @returns {Promise<Object|null>} - Movie data or null if not found
   */
  async getMovieDetails(id) {
    try {
      return await this.request(`/movie/${id}`, {
        append_to_response: "credits,keywords,release_dates,external_ids",
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        log.warn(`Movie ${id} not found`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Get TV show details with credits, keywords, etc.
   * @param {number} id - TMDB TV ID
   * @returns {Promise<Object|null>} - TV data or null if not found
   */
  async getTVDetails(id) {
    try {
      return await this.request(`/tv/${id}`, {
        append_to_response: "credits,aggregate_credits,keywords,content_ratings,external_ids",
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        log.warn(`TV show ${id} not found`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Get details for a title (movie or TV)
   * @param {number} id - TMDB ID
   * @param {"movie"|"tv"} kind - Type of title
   * @returns {Promise<Object|null>}
   */
  async getDetails(id, kind) {
    if (kind === "movie") {
      return this.getMovieDetails(id);
    } else if (kind === "tv") {
      return this.getTVDetails(id);
    } else {
      throw new Error(`Invalid kind: ${kind}`);
    }
  }

  /**
   * Discover movies
   * @param {Object} params - Discovery parameters
   * @returns {Promise<Object>}
   */
  async discoverMovies(params = {}) {
    return this.request("/discover/movie", {
      sort_by: "popularity.desc",
      include_adult: false,
      ...params,
    });
  }

  /**
   * Discover TV shows
   * @param {Object} params - Discovery parameters
   * @returns {Promise<Object>}
   */
  async discoverTV(params = {}) {
    return this.request("/discover/tv", {
      sort_by: "popularity.desc",
      include_adult: false,
      ...params,
    });
  }
}

/**
 * Create a TMDB client with default rate limiter
 * @param {import("../lib/rate-limiter.js").RateLimiter} rateLimiter
 * @returns {TMDBClient}
 */
export function createTMDBClient(rateLimiter) {
  return new TMDBClient(rateLimiter);
}
