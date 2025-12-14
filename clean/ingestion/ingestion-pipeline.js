/**
 * Ingestion Pipeline
 * Fetches full TMDB details for discovered titles and inserts into main titles table
 *
 * This pipeline:
 * 1. Fetches pending titles from `discovered_titles` ordered by popularity
 * 2. Gets full details from TMDB API (cast, director, writers, genres, etc.)
 * 3. Normalizes and standardizes the data
 * 4. Batch upserts into the main `titles` table
 * 5. Updates `discovered_titles` status
 *
 * Usage:
 *   node clean/ingestion/ingestion-pipeline.js                    # Default: ingest 50000 titles
 *   node clean/ingestion/ingestion-pipeline.js --limit 100000     # Custom limit
 *   node clean/ingestion/ingestion-pipeline.js --movies-only      # Only ingest movies
 *   node clean/ingestion/ingestion-pipeline.js --tv-only          # Only ingest TV shows
 *   node clean/ingestion/ingestion-pipeline.js --resume           # Resume from checkpoint
 *   node clean/ingestion/ingestion-pipeline.js --retry-failed     # Retry previously failed titles
 */

import dotenv from "dotenv";
import { createSupabaseClient, batchUpsert, safeUpdate, withRetry, sleep } from "../lib/db-utils.js";
import { getMovieDetails, getTvDetails, checkConnection } from "../tmdb/client.js";
import { extractAllMetadata } from "../tmdb/extractors.js";
import { normalizeGenre } from "../genre-standardizer.js";
import { RateLimiter } from "../lib/rate-limiter.js";
import { ProgressTracker } from "../lib/progress-tracker.js";
import { FailureLogger } from "../lib/failure-logger.js";
import { CONFIG } from "../lib/config.js";

dotenv.config();

/**
 * Sanitize date fields - converts empty strings to null for PostgreSQL DATE type
 * @param {string|null|undefined} value - Date value to sanitize
 * @returns {string|null} - Valid date string or null
 */
function sanitizeDate(value) {
  if (!value || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  return value;
}

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

const LIMIT = parseInt(getArg("limit", "50000"), 10);
const MOVIES_ONLY = args.includes("--movies-only");
const TV_ONLY = args.includes("--tv-only");
const RESUME = args.includes("--resume");
const RETRY_FAILED = args.includes("--retry-failed");

// Scaling config
const SCALING = CONFIG.scaling || {
  ingestion: {
    batchSize: 50,
    titlesPerRun: 50000,
  },
  rateLimits: {
    tmdb: {
      safeDelayMs: 285,
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
  name: "tmdb-ingest",
});

const progress = new ProgressTracker("ingestion", LIMIT);
const failures = new FailureLogger("ingestion");

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Get ingestion status counts from discovered_titles
 * @returns {Promise<Object>} - Object with status counts
 */
async function getIngestionStats() {
  try {
    // Fetch counts individually using Supabase count feature
    const [pending, ingested, failed, skipped] = await Promise.all([
      supabase.from("discovered_titles").select("*", { count: "exact", head: true }).eq("ingestion_status", "pending"),
      supabase.from("discovered_titles").select("*", { count: "exact", head: true }).eq("ingestion_status", "ingested"),
      supabase.from("discovered_titles").select("*", { count: "exact", head: true }).eq("ingestion_status", "failed"),
      supabase.from("discovered_titles").select("*", { count: "exact", head: true }).eq("ingestion_status", "skipped"),
    ]);

    return {
      pending: pending.count || 0,
      ingested: ingested.count || 0,
      failed: failed.count || 0,
      skipped: skipped.count || 0,
    };
  } catch (error) {
    console.warn("Could not fetch ingestion stats:", error.message);
    return null;
  }
}

/**
 * Display ingestion status tracker
 * @param {string} label - Label for the tracker (e.g., "BEFORE" or "AFTER")
 */
async function displayIngestionTracker(label) {
  const stats = await getIngestionStats();
  if (!stats) return;

  const total = (stats.pending || 0) + (stats.ingested || 0) + (stats.failed || 0) + (stats.skipped || 0);
  const notIngested = (stats.pending || 0) + (stats.failed || 0);

  console.log(`\n┌─────────────────────────────────────────────────────────┐`);
  console.log(`│  INGESTION TRACKER (${label.padEnd(6)})                            │`);
  console.log(`├─────────────────────────────────────────────────────────┤`);
  console.log(`│  Total Discovered:    ${total.toLocaleString().padStart(10)}                      │`);
  console.log(`│  ─────────────────────────────────────────────────────  │`);
  console.log(`│  ✓ Ingested:          ${(stats.ingested || 0).toLocaleString().padStart(10)}                      │`);
  console.log(`│  ⏳ Pending:           ${(stats.pending || 0).toLocaleString().padStart(10)}                      │`);
  console.log(`│  ✗ Failed:            ${(stats.failed || 0).toLocaleString().padStart(10)}                      │`);
  console.log(`│  ⊘ Skipped:           ${(stats.skipped || 0).toLocaleString().padStart(10)}                      │`);
  console.log(`│  ─────────────────────────────────────────────────────  │`);
  console.log(`│  📊 NOT INGESTED:     ${notIngested.toLocaleString().padStart(10)}                      │`);
  console.log(`└─────────────────────────────────────────────────────────┘\n`);
}

/**
 * Fetch pending discovered titles ordered by popularity with pagination
 * Supabase has a default 1000 row limit per request, so we paginate
 * @param {number} limit - Maximum titles to fetch
 * @returns {Promise<Array>} - Array of discovered title records
 */
async function getPendingTitles(limit) {
  const PAGE_SIZE = 1000; // Supabase max rows per request
  const allTitles = [];
  let offset = 0;
  let hasMore = true;

  console.log(`   Fetching up to ${limit.toLocaleString()} titles (page size: ${PAGE_SIZE})...`);

  while (hasMore && allTitles.length < limit) {
    const remaining = limit - allTitles.length;
    const fetchSize = Math.min(PAGE_SIZE, remaining);

    const fetchFn = async () => {
      let query = supabase
        .from("discovered_titles")
        .select("*");

      // Include failed titles if --retry-failed flag is set
      if (RETRY_FAILED) {
        query = query.in("ingestion_status", ["pending", "failed"]);
      } else {
        query = query.eq("ingestion_status", "pending");
      }

      if (MOVIES_ONLY) {
        query = query.eq("kind", "movie");
      } else if (TV_ONLY) {
        query = query.eq("kind", "tv");
      }

      query = query
        .order("popularity", { ascending: false })
        .range(offset, offset + fetchSize - 1);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    };

    const batch = await withRetry(fetchFn, { maxRetries: 3 });
    allTitles.push(...batch);

    if (batch.length < fetchSize) {
      hasMore = false;
    } else {
      offset += batch.length;
      process.stdout.write(`\r   Fetched ${allTitles.length.toLocaleString()} titles...`);
    }
  }

  if (allTitles.length > 0) {
    process.stdout.write(`\r   Fetched ${allTitles.length.toLocaleString()} titles    \n`);
  }

  return allTitles;
}

/**
 * Fetch and normalize full title details from TMDB
 * @param {Object} discovered - Discovered title record
 * @returns {Promise<Object>} - Full title record for titles table
 */
async function fetchTitleDetails(discovered) {
  const detailFn = discovered.kind === "movie" ? getMovieDetails : getTvDetails;
  const detail = await detailFn(discovered.id);

  // Extract and normalize metadata using existing extractors
  const metadata = extractAllMetadata(detail, discovered.kind);

  // Standardize genres
  if (metadata.genres?.length > 0) {
    const standardized = new Set();
    metadata.genres.forEach((g) => {
      normalizeGenre(g).forEach((n) => standardized.add(n));
    });
    metadata.genres = [...standardized];
  }

  // Build full title record
  return {
    id: discovered.id,
    kind: discovered.kind,
    imdb_id: detail.imdb_id || detail.external_ids?.imdb_id || null,
    title: discovered.title,
    original_title: discovered.original_title || (discovered.kind === "movie" ? detail.original_title : detail.original_name),
    overview: detail.overview || discovered.overview,
    release_date: sanitizeDate(discovered.release_date) || sanitizeDate(discovered.kind === "movie" ? detail.release_date : detail.first_air_date),
    runtime_minutes: detail.runtime || (detail.episode_run_time && detail.episode_run_time[0]) || null,
    poster_path: detail.poster_path || discovered.poster_path,
    backdrop_path: detail.backdrop_path || discovered.backdrop_path,
    vote_average: detail.vote_average || discovered.vote_average,
    vote_count: detail.vote_count || discovered.vote_count,
    popularity: detail.popularity || discovered.popularity,
    genres: metadata.genres || [],
    languages: (detail.spoken_languages || []).map((l) => l.iso_639_1).filter(Boolean),
    cast: metadata.cast || null,
    director: metadata.director || null,
    writers: metadata.writers || [],
    creators: metadata.creators || [],
    keywords: metadata.keywords || [],
    certification: metadata.certification || null,
    production_countries: metadata.production_countries || [],
    collection_id: metadata.collection_id || null,
    collection_name: metadata.collection_name || null,
    tagline: metadata.tagline || null,
    providers: metadata.providers || null,
    discovery_source: discovered.discovery_source,
    discovered_at: discovered.discovered_at,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Update discovered title status
 * @param {Array<number>} ids - Title IDs to update
 * @param {string} status - New status ('ingested', 'failed', 'skipped')
 * @param {string} errorMessage - Optional error message
 */
async function updateDiscoveredStatus(ids, status, errorMessage = null) {
  if (ids.length === 0) return;

  const update = {
    ingestion_status: status,
    ingested_at: status === "ingested" ? new Date().toISOString() : null,
    error_message: errorMessage,
  };

  await safeUpdate(supabase, "discovered_titles", update, { id: ids });
}

// ============================================================================
// Main Ingestion Loop
// ============================================================================

async function main() {
  console.log("═".repeat(60));
  console.log("INGESTION PIPELINE");
  console.log("═".repeat(60));
  console.log(`Limit: ${LIMIT.toLocaleString()} titles`);
  if (MOVIES_ONLY) console.log(`Filter: Movies only`);
  if (TV_ONLY) console.log(`Filter: TV shows only`);
  if (RESUME) console.log(`Mode: Resume from checkpoint`);
  if (RETRY_FAILED) console.log(`Mode: Retry failed titles`);
  console.log("");

  // Display initial ingestion tracker
  await displayIngestionTracker("BEFORE");

  // Check TMDB connection
  console.log("🔌 Checking TMDB API connection...");
  const connected = await checkConnection();
  if (!connected) {
    console.error("❌ Cannot connect to TMDB API. Check your TMDB_TOKEN.");
    process.exit(1);
  }
  console.log("✓ TMDB API connected\n");

  // Handle resume
  let processedIds = [];
  if (RESUME && progress.hasExistingProgress()) {
    processedIds = progress.getProcessedIds();
    console.log(`📂 Resuming from checkpoint: ${processedIds.length} titles already processed\n`);
  }

  // Fetch pending titles
  console.log("📥 Fetching pending titles from discovered_titles...");
  const pending = await getPendingTitles(LIMIT);
  console.log(`Found ${pending.length.toLocaleString()} pending titles\n`);

  if (pending.length === 0) {
    console.log("⚠️  No pending titles to ingest.");
    console.log("   Run the discovery pipeline first:");
    console.log("   node clean/discovery/discovery-pipeline.js");
    return;
  }

  // Filter out already processed if resuming
  const titlesToProcess = RESUME
    ? pending.filter((t) => !processedIds.includes(t.id))
    : pending;

  if (titlesToProcess.length === 0) {
    console.log("⚠️  All pending titles already processed in this session.");
    return;
  }

  console.log(`📋 Processing ${titlesToProcess.length.toLocaleString()} titles\n`);
  console.log("─".repeat(60));

  const startTime = Date.now();
  let batch = [];
  let batchIds = [];
  let successCount = 0;
  let failedCount = 0;
  const batchSize = SCALING.ingestion?.batchSize || 50;

  for (let i = 0; i < titlesToProcess.length; i++) {
    const discovered = titlesToProcess[i];

    try {
      await rateLimiter.acquire();

      const title = await fetchTitleDetails(discovered);
      batch.push(title);
      batchIds.push(discovered.id);

      rateLimiter.reportSuccess();

      // Batch insert
      if (batch.length >= batchSize) {
        const { success, failed } = await batchUpsert(supabase, "titles", batch, {
          onConflict: "id",
        });

        if (success > 0) {
          await updateDiscoveredStatus(batchIds, "ingested");
          successCount += success;
        }
        if (failed > 0) {
          failedCount += failed;
        }

        progress.update({ processed: successCount + failedCount, success: successCount });
        process.stdout.write(
          `\r  [${successCount}/${titlesToProcess.length}] Ingested batch of ${batch.length} | ` +
          `Failed: ${failedCount} | ` +
          `Rate: ${((successCount / ((Date.now() - startTime) / 1000)) * 60).toFixed(0)}/min`
        );

        // Mark processed for checkpoint
        batchIds.forEach((id) => progress.markProcessed(id));

        batch = [];
        batchIds = [];

        // Checkpoint every 500 titles
        if ((successCount + failedCount) % 500 === 0) {
          progress.setCheckpoint(i);
        }
      }
    } catch (error) {
      rateLimiter.reportError();
      failedCount++;
      failures.logFailure(discovered.id, discovered.title, "ingestion", error.message);
      await updateDiscoveredStatus([discovered.id], "failed", error.message);

      // Log but continue
      if (error.response?.status === 404) {
        console.log(`\n  ⚠️  ${discovered.title} (ID: ${discovered.id}) not found in TMDB`);
      }
    }
  }

  // Insert remaining batch
  if (batch.length > 0) {
    const { success, failed } = await batchUpsert(supabase, "titles", batch, {
      onConflict: "id",
    });

    if (success > 0) {
      await updateDiscoveredStatus(batchIds, "ingested");
      successCount += success;
    }
    if (failed > 0) {
      failedCount += failed;
    }

    batchIds.forEach((id) => progress.markProcessed(id));
  }

  // Final checkpoint
  progress.setCheckpoint(titlesToProcess.length - 1);

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

  // Summary
  console.log("\n\n" + "═".repeat(60));
  console.log("INGESTION COMPLETE");
  console.log("═".repeat(60));
  console.log(`✓ Successfully ingested: ${successCount.toLocaleString()} titles`);
  console.log(`✗ Failed: ${failedCount.toLocaleString()} titles`);
  console.log(`⏱️  Duration: ${duration} minutes`);
  console.log(`📊 Rate: ${(successCount / parseFloat(duration)).toFixed(0)} titles/minute`);
  console.log("");

  if (failures.getFailureCount() > 0) {
    failures.printSummary();
  }

  // Display final ingestion tracker
  await displayIngestionTracker("AFTER");

  console.log("💡 Next step: Run the enrichment pipeline to add Wikipedia data and embeddings");
  console.log("   node clean/enrichment-pipeline.js --skip-enriched");
  console.log("═".repeat(60));
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
