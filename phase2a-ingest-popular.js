// Phase 2A: Ingest Popular Titles
// Fetches popular movies and TV shows from TMDB to reach 6,000 titles
import "dotenv/config.js";
import { getMoviesPage, getMovieDetails, normalizeMovie, getTvPage, getTvDetails, normalizeTv } from "./tmdb.js";
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
const MOVIES_PAGES = config.discovery_strategies.popular.movies_pages;
const TV_PAGES = config.discovery_strategies.popular.tv_pages;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("🎬 Phase 2A: Ingest Popular Titles");
console.log("━".repeat(60));
console.log(`Target: ${config.discovery_strategies.popular.target_titles} titles`);
console.log(`Movies: ${MOVIES_PAGES} pages (~${MOVIES_PAGES * 20} titles)`);
console.log(`TV Shows: ${TV_PAGES} pages (~${TV_PAGES * 20} titles)`);
console.log("━".repeat(60) + "\n");

/**
 * Get existing title IDs to avoid duplicates
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
function logProgress(phase, type, stats) {
  const logDir = path.join(__dirname, config.logging.log_directory);
  const logFile = path.join(logDir, `phase2a-${type}-progress.json`);

  const logEntry = {
    phase,
    type,
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
    result.errors.forEach((err) => console.warn(`   ${err.message}`));
  }

  return { success: result.success, failed: result.failed };
}

/**
 * Ingest popular movies
 */
async function ingestMovies(pages, existingIds) {
  console.log(`\n🎬 Ingesting popular movies (${pages} pages)...\n`);

  const totalMovies = pages * 20;
  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let batch = [];

  for (let p = 1; p <= pages; p++) {
    try {
      const page = await getMoviesPage(p);
      await sleep(TMDB_DELAY);

      for (const m of page) {
        processedCount++;

        // Skip if already exists
        if (existingIds.has(m.id)) {
          skippedCount++;
          if (processedCount % 50 === 0) {
            console.log(`[${processedCount}/${totalMovies}] Processing... (${skippedCount} skipped)`);
          }
          continue;
        }

        try {
          const details = await getMovieDetails(m.id);
          await sleep(TMDB_DELAY);

          const normalized = normalizeMovie(details);
          batch.push(normalized);

          // Process batch when full
          if (batch.length >= BATCH_SIZE) {
            const result = await processBatch(batch, "movies", processedCount, totalMovies);
            successCount += result.success;
            failedCount += result.failed;
            batch = [];

            // Log progress every 10 batches
            if (processedCount % (BATCH_SIZE * 10) === 0) {
              logProgress("2a", "movies", {
                processed: processedCount,
                success: successCount,
                failed: failedCount,
                skipped: skippedCount,
              });
            }
          }
        } catch (error) {
          console.warn(`⚠️  Failed to fetch movie ${m.id}: ${error.message}`);
          failedCount++;
        }
      }

      // Progress update
      if (p % 10 === 0) {
        console.log(`📄 Processed page ${p}/${pages} (${processedCount}/${totalMovies} movies)`);
      }
    } catch (error) {
      console.error(`❌ Failed to fetch page ${p}: ${error.message}`);
    }
  }

  // Process remaining batch
  if (batch.length > 0) {
    const result = await processBatch(batch, "movies", processedCount, totalMovies);
    successCount += result.success;
    failedCount += result.failed;
  }

  const stats = {
    processed: processedCount,
    success: successCount,
    failed: failedCount,
    skipped: skippedCount,
  };

  logProgress("2a", "movies", stats);

  console.log("\n📊 Movie Ingestion Summary:");
  console.log(`   Processed: ${processedCount}`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Failed: ${failedCount}`);
  console.log(`   Skipped: ${skippedCount}\n`);

  return stats;
}

/**
 * Ingest popular TV shows
 */
async function ingestTvShows(pages, existingIds) {
  console.log(`\n📺 Ingesting popular TV shows (${pages} pages)...\n`);

  const totalShows = pages * 20;
  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let batch = [];

  for (let p = 1; p <= pages; p++) {
    try {
      const page = await getTvPage(p);
      await sleep(TMDB_DELAY);

      for (const tv of page) {
        processedCount++;

        // Skip if already exists
        if (existingIds.has(tv.id)) {
          skippedCount++;
          if (processedCount % 50 === 0) {
            console.log(`[${processedCount}/${totalShows}] Processing... (${skippedCount} skipped)`);
          }
          continue;
        }

        try {
          const details = await getTvDetails(tv.id);
          await sleep(TMDB_DELAY);

          const normalized = normalizeTv(details);
          batch.push(normalized);

          // Process batch when full
          if (batch.length >= BATCH_SIZE) {
            const result = await processBatch(batch, "TV shows", processedCount, totalShows);
            successCount += result.success;
            failedCount += result.failed;
            batch = [];

            // Log progress every 10 batches
            if (processedCount % (BATCH_SIZE * 10) === 0) {
              logProgress("2a", "tv", {
                processed: processedCount,
                success: successCount,
                failed: failedCount,
                skipped: skippedCount,
              });
            }
          }
        } catch (error) {
          console.warn(`⚠️  Failed to fetch TV show ${tv.id}: ${error.message}`);
          failedCount++;
        }
      }

      // Progress update
      if (p % 10 === 0) {
        console.log(`📄 Processed page ${p}/${pages} (${processedCount}/${totalShows} TV shows)`);
      }
    } catch (error) {
      console.error(`❌ Failed to fetch page ${p}: ${error.message}`);
    }
  }

  // Process remaining batch
  if (batch.length > 0) {
    const result = await processBatch(batch, "TV shows", processedCount, totalShows);
    successCount += result.success;
    failedCount += result.failed;
  }

  const stats = {
    processed: processedCount,
    success: successCount,
    failed: failedCount,
    skipped: skippedCount,
  };

  logProgress("2a", "tv", stats);

  console.log("\n📊 TV Show Ingestion Summary:");
  console.log(`   Processed: ${processedCount}`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Failed: ${failedCount}`);
  console.log(`   Skipped: ${skippedCount}\n`);

  return stats;
}

/**
 * Main execution
 */
async function main() {
  try {
    const startTime = Date.now();

    // Get existing IDs
    const existingIds = await getExistingTitleIds();

    // Ingest movies
    const movieStats = await ingestMovies(MOVIES_PAGES, existingIds);

    // Ingest TV shows
    const tvStats = await ingestTvShows(TV_PAGES, existingIds);

    // Summary
    const totalProcessed = movieStats.processed + tvStats.processed;
    const totalSuccess = movieStats.success + tvStats.success;
    const totalFailed = movieStats.failed + tvStats.failed;
    const totalSkipped = movieStats.skipped + tvStats.skipped;

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

    console.log("\n" + "━".repeat(60));
    console.log("✨ PHASE 2A COMPLETE");
    console.log("━".repeat(60));
    console.log("📊 Overall Summary:");
    console.log(`   Total Processed: ${totalProcessed}`);
    console.log(`   Total Success: ${totalSuccess}`);
    console.log(`   Total Failed: ${totalFailed}`);
    console.log(`   Total Skipped: ${totalSkipped}`);
    console.log(`   Duration: ${duration} minutes\n`);
    console.log("📝 Next step:");
    console.log("   Run Phase 2B: node phase2b-ingest-targeted.js");
    console.log("━".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Phase 2A failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
