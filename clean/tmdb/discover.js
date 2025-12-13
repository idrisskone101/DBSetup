/**
 * TMDB Discover API Module
 * Handles paginated discovery of movies and TV shows from The Movie Database
 */

import axios from "axios";
import fs from "fs";
import path from "path";

// Manual .env parsing (isolated from root project)
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

const TMDB_TOKEN = process.env.TMDB_TOKEN;

if (!TMDB_TOKEN) {
  console.error("❌ TMDB_TOKEN not found in environment");
  console.error("   Add: TMDB_TOKEN=your_bearer_token_here");
}

// Create axios instance with default config
const tmdbClient = axios.create({
  baseURL: "https://api.themoviedb.org/3",
  headers: {
    Authorization: `Bearer ${TMDB_TOKEN}`,
    "Content-Type": "application/json;charset=utf-8",
  },
  timeout: 30000, // 30 second timeout
});

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Sleep utility
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Make a request with retry logic
 */
async function withRetry(requestFn, retries = MAX_RETRIES) {
  try {
    return await requestFn();
  } catch (error) {
    const status = error.response?.status;

    // Rate limited - wait and retry
    if (status === 429 && retries > 0) {
      const retryAfter = error.response?.headers?.["retry-after"] || 2;
      console.log(`  ⏳ Rate limited. Waiting ${retryAfter}s before retry...`);
      await sleep(retryAfter * 1000);
      return withRetry(requestFn, retries - 1);
    }

    // Server error - retry with backoff
    if (status >= 500 && retries > 0) {
      const delay = RETRY_DELAY_MS * (MAX_RETRIES - retries + 1);
      console.log(`  ⏳ Server error (${status}). Retrying in ${delay}ms...`);
      await sleep(delay);
      return withRetry(requestFn, retries - 1);
    }

    // Timeout - retry
    if (error.code === "ECONNABORTED" && retries > 0) {
      console.log(`  ⏳ Request timeout. Retrying...`);
      await sleep(RETRY_DELAY_MS);
      return withRetry(requestFn, retries - 1);
    }

    throw error;
  }
}

/**
 * Discover movies with filters
 * @param {Object} params - Discovery parameters
 * @param {number} params.page - Page number (1-500)
 * @param {string} params.sortBy - Sort order (default: popularity.desc)
 * @param {number} params.year - Filter by primary release year
 * @param {string} params.withGenres - Comma-separated genre IDs
 * @param {number} params.voteCountGte - Minimum vote count
 * @returns {Promise<{results: Array, page: number, totalPages: number, totalResults: number}>}
 */
export async function discoverMovies(params = {}) {
  const response = await withRetry(() =>
    tmdbClient.get("/discover/movie", {
      params: {
        page: params.page || 1,
        sort_by: params.sortBy || "popularity.desc",
        primary_release_year: params.year,
        with_genres: params.withGenres,
        "vote_count.gte": params.voteCountGte,
        include_adult: false,
        include_video: false,
        language: "en-US",
      },
    })
  );

  return {
    results: response.data.results || [],
    page: response.data.page,
    totalPages: Math.min(response.data.total_pages, 500), // TMDB caps at 500 pages
    totalResults: response.data.total_results,
  };
}

/**
 * Discover TV shows with filters
 * @param {Object} params - Discovery parameters
 * @param {number} params.page - Page number (1-500)
 * @param {string} params.sortBy - Sort order (default: popularity.desc)
 * @param {number} params.year - Filter by first air date year
 * @param {string} params.withGenres - Comma-separated genre IDs
 * @param {number} params.voteCountGte - Minimum vote count
 * @returns {Promise<{results: Array, page: number, totalPages: number, totalResults: number}>}
 */
export async function discoverTv(params = {}) {
  const response = await withRetry(() =>
    tmdbClient.get("/discover/tv", {
      params: {
        page: params.page || 1,
        sort_by: params.sortBy || "popularity.desc",
        first_air_date_year: params.year,
        with_genres: params.withGenres,
        "vote_count.gte": params.voteCountGte,
        include_adult: false,
        include_null_first_air_dates: false,
        language: "en-US",
      },
    })
  );

  return {
    results: response.data.results || [],
    page: response.data.page,
    totalPages: Math.min(response.data.total_pages, 500), // TMDB caps at 500 pages
    totalResults: response.data.total_results,
  };
}

/**
 * Get TMDB genre list for movies or TV
 * @param {string} kind - "movie" or "tv"
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
export async function getGenres(kind = "movie") {
  const endpoint = kind === "movie" ? "/genre/movie/list" : "/genre/tv/list";
  const response = await withRetry(() =>
    tmdbClient.get(endpoint, { params: { language: "en-US" } })
  );
  return response.data.genres || [];
}

/**
 * Normalize a discover result to the staging table format
 * @param {Object} item - Raw TMDB discover result
 * @param {string} kind - "movie" or "tv"
 * @param {string} source - Discovery source identifier
 * @returns {Object} Normalized record for discovered_titles table
 */
export function normalizeDiscoverResult(item, kind, source) {
  // Movies use "title" and "release_date", TV uses "name" and "first_air_date"
  const title = kind === "movie" ? item.title : item.name;
  const originalTitle = kind === "movie" ? item.original_title : item.original_name;
  const releaseDate = kind === "movie" ? item.release_date : item.first_air_date;

  return {
    id: item.id,
    kind,
    title: title || "Unknown Title",
    original_title: originalTitle || null,
    overview: item.overview || null,
    release_date: releaseDate || null,
    popularity: item.popularity || 0,
    vote_average: item.vote_average || 0,
    vote_count: item.vote_count || 0,
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    discovery_source: source,
    discovered_at: new Date().toISOString(),
    ingestion_status: "pending",
  };
}

/**
 * Check if TMDB API is accessible
 * @returns {Promise<boolean>}
 */
export async function checkConnection() {
  try {
    await tmdbClient.get("/configuration");
    return true;
  } catch (error) {
    console.error("❌ Failed to connect to TMDB API:", error.message);
    return false;
  }
}

/**
 * Get configuration (for debugging)
 * @returns {Promise<Object>}
 */
export async function getConfiguration() {
  const response = await withRetry(() => tmdbClient.get("/configuration"));
  return response.data;
}

export { sleep };

export default {
  discoverMovies,
  discoverTv,
  getGenres,
  normalizeDiscoverResult,
  checkConnection,
  getConfiguration,
  sleep,
};
