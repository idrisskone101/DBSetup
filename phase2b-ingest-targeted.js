// Phase 2B: Ingest Targeted Titles
// Fetches titles by genre and year range to reach 10,000 total titles
import "dotenv/config.js";
import axios from "axios";
import { getMovieDetails, normalizeMovie, getTvDetails, normalizeTv } from "./tmdb.js";
import { batchUpsertTitles, supabase } from "./supabase-upsert.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "scaling-config.json"), "utf-8")
);

const BATCH_SIZE = config.batch_sizes.tmdb_ingestion.titles_per_page;
const TMDB_DELAY = config.rate_limits.tmdb.delay_ms;
const TMDB_TOKEN = process.env.TMDB_TOKEN;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("🎯 Phase 2B: Ingest Targeted Titles");
console.log("━".repeat(60));
console.log(`Target: ${config.discovery_strategies.targeted.target_titles} additional titles`);
console.log(`Genres: ${config.discovery_strategies.targeted.genres.join(", ")}`);
console.log(`Year Ranges: ${config.discovery_strategies.targeted.year_ranges.length} ranges`);
console.log("━".repeat(60) + "\n");

// Genre ID mapping for TMDB
const GENRE_MAP = {
  "Action": 28,
  "Drama": 18,
  "Comedy": 35,
  "Science Fiction": 878,
  "Horror": 27,
  "Thriller": 53,
  "Romance": 10749,
  "Documentary": 99,
};

/**
 * Get existing title IDs
 */
async function getExistingTitleIds() {
  console.log("📊 Fetching existing title IDs from database...");
  const { data, error } = await supabase.from("titles").select("id");

  if (error) {
    console.warn(`⚠️  Could not fetch existing IDs: ${error.message}`);
    return new Set();
  }

  const existingIds = new Set(data.map((row) => row.id));
  console.log(`✅ Found ${existingIds.size} existing titles in database\n`);
  return existingIds;
}

/**
 * Log progress to file
 */
function logProgress(phase, category, stats) {
  const logDir = path.join(__dirname, config.logging.log_directory);
  const logFile = path.join(logDir, `phase2b-${category}-progress.json`);

  const logEntry = {
    phase,
    category,
    timestamp: new Date().toISOString(),
    stats,
  };

  fs.writeFileSync(logFile, JSON.stringify(logEntry, null, 2));
}

/**
 * Process a batch of titles
 */
async function processBatch(batch, type, currentCount, totalCount) {
  if (batch.length === 0) return { success: 0, failed: 0 };

  const result = await batchUpsertTitles(batch, null);

  if (result.success > 0) {
    console.log(`✅ [${currentCount}/${totalCount}] Upserted ${result.success} ${type}`);
  }

  if (result.failed > 0) {
    console.warn(`⚠️  Failed to upsert ${result.failed} ${type}`);
  }

  return { success: result.success, failed: result.failed };
}

/**
 * Discover titles by genre and year range
 */
async function discoverTitles(mediaType, genreId, genreName, yearRange, pages, existingIds) {
  console.log(`\n🔍 Discovering ${mediaType} - ${genreName} (${yearRange.start}-${yearRange.end})...`);

  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let batch = [];

  const url = `https://api.themoviedb.org/3/discover/${mediaType}`;

  for (let p = 1; p <= pages; p++) {
    try {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
        params: {
          with_genres: genreId,
          "primary_release_date.gte": `${yearRange.start}-01-01`,
          "primary_release_date.lte": `${yearRange.end}-12-31`,
          "first_air_date.gte": `${yearRange.start}-01-01`,
          "first_air_date.lte": `${yearRange.end}-12-31`,
          "vote_average.gte": config.discovery_strategies.targeted.min_vote_average,
          "vote_count.gte": config.discovery_strategies.targeted.min_vote_count,
          sort_by: "popularity.desc",
          page: p,
        },
      });

      await sleep(TMDB_DELAY);

      const results = response.data.results || [];

      for (const item of results) {
        processedCount++;

        // Skip if already exists
        if (existingIds.has(item.id)) {
          skippedCount++;
          continue;
        }

        try {
          let details, normalized;

          if (mediaType === "movie") {
            details = await getMovieDetails(item.id);
            normalized = normalizeMovie(details);
          } else {
            details = await getTvDetails(item.id);
            normalized = normalizeTv(details);
          }

          await sleep(TMDB_DELAY);

          batch.push(normalized);
          existingIds.add(item.id); // Mark as processed

          // Process batch when full
          if (batch.length >= BATCH_SIZE) {
            const result = await processBatch(batch, `${genreName} ${mediaType}`, processedCount, pages * 20);
            successCount += result.success;
            failedCount += result.failed;
            batch = [];
          }
        } catch (error) {
          console.warn(`⚠️  Failed to fetch ${mediaType} ${item.id}: ${error.message}`);
          failedCount++;
        }
      }

      if (p % 5 === 0) {
        console.log(`   Page ${p}/${pages}: ${processedCount} processed, ${successCount} added, ${skippedCount} skipped`);
      }
    } catch (error) {
      console.error(`❌ Failed to fetch page ${p}: ${error.message}`);
    }
  }

  // Process remaining batch
  if (batch.length > 0) {
    const result = await processBatch(batch, `${genreName} ${mediaType}`, processedCount, pages * 20);
    successCount += result.success;
    failedCount += result.failed;
  }

  return { processed: processedCount, success: successCount, failed: failedCount, skipped: skippedCount };
}

/**
 * Main execution
 */
async function main() {
  try {
    const startTime = Date.now();
    let existingIds = await getExistingTitleIds();

    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    // Iterate through genres
    for (const genre of config.discovery_strategies.targeted.genres) {
      const genreId = GENRE_MAP[genre];

      if (!genreId) {
        console.warn(`⚠️  Unknown genre: ${genre}`);
        continue;
      }

      console.log(`\n${"═".repeat(60)}`);
      console.log(`📂 Genre: ${genre}`);
      console.log("═".repeat(60));

      // Iterate through year ranges
      for (const yearRange of config.discovery_strategies.targeted.year_ranges) {
        // Discover movies
        const movieStats = await discoverTitles(
          "movie",
          genreId,
          genre,
          yearRange,
          yearRange.pages,
          existingIds
        );

        totalProcessed += movieStats.processed;
        totalSuccess += movieStats.success;
        totalFailed += movieStats.failed;
        totalSkipped += movieStats.skipped;

        logProgress("2b", `${genre}-movies-${yearRange.start}`, movieStats);

        // Discover TV shows
        const tvStats = await discoverTitles(
          "tv",
          genreId,
          genre,
          yearRange,
          yearRange.pages,
          existingIds
        );

        totalProcessed += tvStats.processed;
        totalSuccess += tvStats.success;
        totalFailed += tvStats.failed;
        totalSkipped += tvStats.skipped;

        logProgress("2b", `${genre}-tv-${yearRange.start}`, tvStats);

        console.log(`   ${genre} ${yearRange.start}-${yearRange.end}: +${movieStats.success + tvStats.success} titles`);
      }
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

    console.log("\n" + "━".repeat(60));
    console.log("✨ PHASE 2B COMPLETE");
    console.log("━".repeat(60));
    console.log("📊 Overall Summary:");
    console.log(`   Total Processed: ${totalProcessed}`);
    console.log(`   Total Success: ${totalSuccess}`);
    console.log(`   Total Failed: ${totalFailed}`);
    console.log(`   Total Skipped: ${totalSkipped}`);
    console.log(`   Duration: ${duration} minutes\n`);
    console.log("📝 Next step:");
    console.log("   Run Phase 3: node phase3-enrich-all.js");
    console.log("━".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Phase 2B failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
