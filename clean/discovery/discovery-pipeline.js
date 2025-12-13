/**
 * Discovery Pipeline
 * Discovers new titles from TMDB and stages them for ingestion
 *
 * This pipeline:
 * 1. Loads all existing title IDs from both `titles` and `discovered_titles` tables
 * 2. Paginates through TMDB discover API for movies and TV shows
 * 3. Filters out any titles that already exist
 * 4. Inserts only NEW titles into the `discovered_titles` staging table
 *
 * Usage:
 *   node clean/discovery/discovery-pipeline.js                    # Default: discover 50000 popular titles
 *   node clean/discovery/discovery-pipeline.js --mode popular     # Discover by popularity
 *   node clean/discovery/discovery-pipeline.js --mode genre       # Discover by genre (deeper coverage)
 *   node clean/discovery/discovery-pipeline.js --limit 100000     # Custom limit
 *   node clean/discovery/discovery-pipeline.js --movies-only      # Only discover movies
 *   node clean/discovery/discovery-pipeline.js --tv-only          # Only discover TV shows
 */

import dotenv from "dotenv";
import { createSupabaseClient, fetchAllIds, batchUpsert, sleep } from "../lib/db-utils.js";
import { discoverMovies, discoverTv, normalizeDiscoverResult, getGenres, checkConnection } from "../tmdb/discover.js";
import { RateLimiter } from "../lib/rate-limiter.js";
import { ProgressTracker } from "../lib/progress-tracker.js";
import { CONFIG } from "../lib/config.js";

dotenv.config();

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const args = process.argv.slice(2);

function getArg(name, defaultValue) {
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
    return args[index + 1];
  }
  return defaultValue;
}

const MODE = getArg("mode", "popular"); // "popular" or "genre"
const LIMIT = parseInt(getArg("limit", "50000"), 10);
const MOVIES_ONLY = args.includes("--movies-only");
const TV_ONLY = args.includes("--tv-only");

// Scaling config (can be overridden by CONFIG.scaling if available)
const SCALING = CONFIG.scaling || {
  discovery: {
    pagesPerRun: 500,
    titlesPerPage: 20,
  },
  rateLimits: {
    tmdb: {
      safeDelayMs: 285, // 3.5 req/sec
    },
  },
};

// ============================================================================
// Setup
// ============================================================================

const supabase = createSupabaseClient();

const rateLimiter = new RateLimiter({
  delayMs: SCALING.rateLimits?.tmdb?.safeDelayMs || 285,
  maxRetries: 3,
  backoffMultiplier: 2,
  name: "tmdb-discover",
});

// ============================================================================
// Discovery Functions
// ============================================================================

/**
 * Discover popular titles (movies and/or TV shows)
 * @param {Set<number>} existingMovieIds - Set of existing movie IDs
 * @param {Set<number>} existingTvIds - Set of existing TV show IDs
 * @param {number} limit - Maximum titles to discover
 * @returns {Promise<{movies: number, tv: number}>}
 */
async function discoverPopular(existingMovieIds, existingTvIds, limit) {
  let moviesDiscovered = 0;
  let tvDiscovered = 0;
  let batch = [];

  const movieLimit = MOVIES_ONLY ? limit : TV_ONLY ? 0 : Math.ceil(limit / 2);
  const tvLimit = TV_ONLY ? limit : MOVIES_ONLY ? 0 : Math.floor(limit / 2);

  const maxPages = SCALING.discovery?.pagesPerRun || 500;

  // Discover Movies
  if (movieLimit > 0) {
    console.log("\n--- Discovering Popular Movies ---");
    console.log(`Target: ${movieLimit.toLocaleString()} new movies`);

    for (let page = 1; page <= maxPages && moviesDiscovered < movieLimit; page++) {
      await rateLimiter.acquire();

      try {
        const result = await discoverMovies({ page, sortBy: "popularity.desc" });

        for (const item of result.results) {
          if (existingMovieIds.has(item.id)) continue;

          batch.push(normalizeDiscoverResult(item, "movie", "popular"));
          existingMovieIds.add(item.id);
          moviesDiscovered++;

          if (moviesDiscovered >= movieLimit) break;
        }

        rateLimiter.reportSuccess();

        // Batch insert every 100 titles
        if (batch.length >= 100) {
          await batchUpsert(supabase, "discovered_titles", batch, { ignoreDuplicates: true });
          process.stdout.write(`\r  [${moviesDiscovered}/${movieLimit}] Discovered movies (page ${page}/${result.totalPages})`);
          batch = [];
        }

        // Stop if we've exhausted all pages
        if (page >= result.totalPages) {
          console.log(`\n  Reached end of available movies at page ${page}`);
          break;
        }
      } catch (error) {
        rateLimiter.reportError();
        console.error(`\n  Error on page ${page}: ${error.message}`);
      }
    }

    // Insert remaining batch
    if (batch.length > 0) {
      await batchUpsert(supabase, "discovered_titles", batch, { ignoreDuplicates: true });
      batch = [];
    }

    console.log(`\n  ✓ Discovered ${moviesDiscovered.toLocaleString()} new movies`);
  }

  // Discover TV Shows
  if (tvLimit > 0) {
    console.log("\n--- Discovering Popular TV Shows ---");
    console.log(`Target: ${tvLimit.toLocaleString()} new TV shows`);

    for (let page = 1; page <= maxPages && tvDiscovered < tvLimit; page++) {
      await rateLimiter.acquire();

      try {
        const result = await discoverTv({ page, sortBy: "popularity.desc" });

        for (const item of result.results) {
          if (existingTvIds.has(item.id)) continue;

          batch.push(normalizeDiscoverResult(item, "tv", "popular"));
          existingTvIds.add(item.id);
          tvDiscovered++;

          if (tvDiscovered >= tvLimit) break;
        }

        rateLimiter.reportSuccess();

        // Batch insert every 100 titles
        if (batch.length >= 100) {
          await batchUpsert(supabase, "discovered_titles", batch, { ignoreDuplicates: true });
          process.stdout.write(`\r  [${tvDiscovered}/${tvLimit}] Discovered TV shows (page ${page}/${result.totalPages})`);
          batch = [];
        }

        // Stop if we've exhausted all pages
        if (page >= result.totalPages) {
          console.log(`\n  Reached end of available TV shows at page ${page}`);
          break;
        }
      } catch (error) {
        rateLimiter.reportError();
        console.error(`\n  Error on page ${page}: ${error.message}`);
      }
    }

    // Insert remaining batch
    if (batch.length > 0) {
      await batchUpsert(supabase, "discovered_titles", batch, { ignoreDuplicates: true });
      batch = [];
    }

    console.log(`\n  ✓ Discovered ${tvDiscovered.toLocaleString()} new TV shows`);
  }

  return { movies: moviesDiscovered, tv: tvDiscovered };
}

/**
 * Discover by genre for deeper coverage
 * Useful after popular discovery to get more niche titles
 */
async function discoverByGenre(existingMovieIds, existingTvIds, limit) {
  let moviesDiscovered = 0;
  let tvDiscovered = 0;
  let batch = [];

  const movieLimit = MOVIES_ONLY ? limit : TV_ONLY ? 0 : Math.ceil(limit / 2);
  const tvLimit = TV_ONLY ? limit : MOVIES_ONLY ? 0 : Math.floor(limit / 2);

  // Get genre lists
  const movieGenres = await getGenres("movie");
  const tvGenres = await getGenres("tv");

  // Year ranges to explore
  const yearRanges = [
    { start: 2020, end: 2025 },
    { start: 2010, end: 2019 },
    { start: 2000, end: 2009 },
    { start: 1990, end: 1999 },
    { start: 1980, end: 1989 },
    { start: 1970, end: 1979 },
  ];

  const pagesPerGenreYear = 50; // Pages per genre+year combo

  // Discover Movies by Genre
  if (movieLimit > 0) {
    console.log("\n--- Discovering Movies by Genre ---");
    console.log(`Target: ${movieLimit.toLocaleString()} new movies`);

    genreLoop: for (const genre of movieGenres) {
      if (moviesDiscovered >= movieLimit) break;

      for (const yearRange of yearRanges) {
        for (let year = yearRange.end; year >= yearRange.start; year--) {
          if (moviesDiscovered >= movieLimit) break genreLoop;

          for (let page = 1; page <= pagesPerGenreYear; page++) {
            if (moviesDiscovered >= movieLimit) break genreLoop;

            await rateLimiter.acquire();

            try {
              const result = await discoverMovies({
                page,
                withGenres: genre.id.toString(),
                year,
                sortBy: "popularity.desc",
              });

              for (const item of result.results) {
                if (existingMovieIds.has(item.id)) continue;

                batch.push(normalizeDiscoverResult(item, "movie", `genre:${genre.name}:${year}`));
                existingMovieIds.add(item.id);
                moviesDiscovered++;

                if (moviesDiscovered >= movieLimit) break;
              }

              rateLimiter.reportSuccess();

              // Batch insert every 100 titles
              if (batch.length >= 100) {
                await batchUpsert(supabase, "discovered_titles", batch, { ignoreDuplicates: true });
                console.log(`  [${moviesDiscovered}] ${genre.name} ${year} page ${page}: +${batch.length}`);
                batch = [];
              }

              // Stop if no more results
              if (result.results.length === 0 || page >= result.totalPages) break;
            } catch (error) {
              rateLimiter.reportError();
            }
          }
        }
      }
    }

    if (batch.length > 0) {
      await batchUpsert(supabase, "discovered_titles", batch, { ignoreDuplicates: true });
      batch = [];
    }

    console.log(`\n  ✓ Discovered ${moviesDiscovered.toLocaleString()} new movies by genre`);
  }

  // Discover TV Shows by Genre (similar logic)
  if (tvLimit > 0) {
    console.log("\n--- Discovering TV Shows by Genre ---");
    console.log(`Target: ${tvLimit.toLocaleString()} new TV shows`);

    genreLoop: for (const genre of tvGenres) {
      if (tvDiscovered >= tvLimit) break;

      for (const yearRange of yearRanges) {
        for (let year = yearRange.end; year >= yearRange.start; year--) {
          if (tvDiscovered >= tvLimit) break genreLoop;

          for (let page = 1; page <= pagesPerGenreYear; page++) {
            if (tvDiscovered >= tvLimit) break genreLoop;

            await rateLimiter.acquire();

            try {
              const result = await discoverTv({
                page,
                withGenres: genre.id.toString(),
                year,
                sortBy: "popularity.desc",
              });

              for (const item of result.results) {
                if (existingTvIds.has(item.id)) continue;

                batch.push(normalizeDiscoverResult(item, "tv", `genre:${genre.name}:${year}`));
                existingTvIds.add(item.id);
                tvDiscovered++;

                if (tvDiscovered >= tvLimit) break;
              }

              rateLimiter.reportSuccess();

              if (batch.length >= 100) {
                await batchUpsert(supabase, "discovered_titles", batch, { ignoreDuplicates: true });
                console.log(`  [${tvDiscovered}] ${genre.name} ${year} page ${page}: +${batch.length}`);
                batch = [];
              }

              if (result.results.length === 0 || page >= result.totalPages) break;
            } catch (error) {
              rateLimiter.reportError();
            }
          }
        }
      }
    }

    if (batch.length > 0) {
      await batchUpsert(supabase, "discovered_titles", batch, { ignoreDuplicates: true });
      batch = [];
    }

    console.log(`\n  ✓ Discovered ${tvDiscovered.toLocaleString()} new TV shows by genre`);
  }

  return { movies: moviesDiscovered, tv: tvDiscovered };
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log("═".repeat(60));
  console.log("DISCOVERY PIPELINE");
  console.log("═".repeat(60));
  console.log(`Mode: ${MODE}`);
  console.log(`Limit: ${LIMIT.toLocaleString()} titles`);
  if (MOVIES_ONLY) console.log(`Filter: Movies only`);
  if (TV_ONLY) console.log(`Filter: TV shows only`);
  console.log("");

  // Check TMDB connection
  console.log("🔌 Checking TMDB API connection...");
  const connected = await checkConnection();
  if (!connected) {
    console.error("❌ Cannot connect to TMDB API. Check your TMDB_TOKEN.");
    process.exit(1);
  }
  console.log("✓ TMDB API connected\n");

  // Load existing IDs from both tables to avoid duplicates
  console.log("📥 Loading existing title IDs...");

  // Fetch movie IDs
  const existingMovieIds = new Set();
  const titlesMovieIds = await fetchAllIds(supabase, "titles", { kind: "movie" });
  const discoveredMovieIds = await fetchAllIds(supabase, "discovered_titles", { kind: "movie" });
  titlesMovieIds.forEach((id) => existingMovieIds.add(id));
  discoveredMovieIds.forEach((id) => existingMovieIds.add(id));

  // Fetch TV IDs
  const existingTvIds = new Set();
  const titlesTvIds = await fetchAllIds(supabase, "titles", { kind: "tv" });
  const discoveredTvIds = await fetchAllIds(supabase, "discovered_titles", { kind: "tv" });
  titlesTvIds.forEach((id) => existingTvIds.add(id));
  discoveredTvIds.forEach((id) => existingTvIds.add(id));

  console.log(`\n📊 Existing IDs loaded:`);
  console.log(`   Movies: ${existingMovieIds.size.toLocaleString()}`);
  console.log(`   TV Shows: ${existingTvIds.size.toLocaleString()}`);
  console.log("");

  const startTime = Date.now();
  let results;

  // Run discovery based on mode
  switch (MODE) {
    case "popular":
      results = await discoverPopular(existingMovieIds, existingTvIds, LIMIT);
      break;
    case "genre":
      results = await discoverByGenre(existingMovieIds, existingTvIds, LIMIT);
      break;
    default:
      console.error(`Unknown mode: ${MODE}`);
      console.error("Valid modes: popular, genre");
      process.exit(1);
  }

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("DISCOVERY COMPLETE");
  console.log("═".repeat(60));
  console.log(`✓ New movies discovered: ${results.movies.toLocaleString()}`);
  console.log(`✓ New TV shows discovered: ${results.tv.toLocaleString()}`);
  console.log(`✓ Total new titles: ${(results.movies + results.tv).toLocaleString()}`);
  console.log(`⏱️  Duration: ${duration} minutes`);
  console.log("");
  console.log("💡 Next step: Run the ingestion pipeline to fetch full details");
  console.log("   node clean/ingestion/ingestion-pipeline.js");
  console.log("═".repeat(60));
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
