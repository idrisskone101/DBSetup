/**
 * TMDB API Client
 * Isolated client for fetching movie and TV show details from The Movie Database API
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
  console.error("❌ TMDB_TOKEN not found in .env file");
  console.error("   Add: TMDB_TOKEN=your_bearer_token_here");
  process.exit(1);
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
 * Sleep utility for rate limiting and retries
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Make a request with retry logic
 * @param {Function} requestFn - Function that returns a promise
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<any>} - Response data
 */
async function withRetry(requestFn, retries = MAX_RETRIES) {
  try {
    return await requestFn();
  } catch (error) {
    const status = error.response?.status;

    // Rate limited - wait and retry
    if (status === 429 && retries > 0) {
      const retryAfter = error.response?.headers?.["retry-after"] || 2;
      console.log(`⏳ Rate limited. Waiting ${retryAfter}s before retry...`);
      await sleep(retryAfter * 1000);
      return withRetry(requestFn, retries - 1);
    }

    // Server error - retry with backoff
    if (status >= 500 && retries > 0) {
      const delay = RETRY_DELAY_MS * (MAX_RETRIES - retries + 1);
      console.log(`⏳ Server error (${status}). Retrying in ${delay}ms...`);
      await sleep(delay);
      return withRetry(requestFn, retries - 1);
    }

    // Timeout - retry
    if (error.code === "ECONNABORTED" && retries > 0) {
      console.log(`⏳ Request timeout. Retrying...`);
      await sleep(RETRY_DELAY_MS);
      return withRetry(requestFn, retries - 1);
    }

    throw error;
  }
}

/**
 * Get full movie details with all enrichment data
 * @param {number} id - TMDB movie ID
 * @returns {Promise<Object>} - Full movie details with credits, keywords, etc.
 */
export async function getMovieDetails(id) {
  const response = await withRetry(() =>
    tmdbClient.get(`/movie/${id}`, {
      params: {
        append_to_response:
          "credits,watch/providers,external_ids,keywords,release_dates",
      },
    })
  );
  return response.data;
}

/**
 * Get full TV show details with all enrichment data
 * @param {number} id - TMDB TV show ID
 * @returns {Promise<Object>} - Full TV details with credits, keywords, etc.
 */
export async function getTvDetails(id) {
  const response = await withRetry(() =>
    tmdbClient.get(`/tv/${id}`, {
      params: {
        append_to_response:
          "credits,aggregate_credits,watch/providers,external_ids,keywords,content_ratings",
      },
    })
  );
  return response.data;
}

/**
 * Check if TMDB API is accessible
 * @returns {Promise<boolean>} - True if API is accessible
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

export { sleep };

