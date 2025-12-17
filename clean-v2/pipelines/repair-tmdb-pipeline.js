/**
 * TMDB Repair Pipeline
 * Repairs titles with missing TMDB metadata (overview, director, cast, etc.)
 */

import "dotenv/config";
import { getSupabase, updateTitle } from "../lib/supabase.js";
import { createTMDBRateLimiter } from "../lib/rate-limiter.js";
import { ProgressTracker } from "../lib/progress.js";
import { initFileLogging, closeFileLogging, info, error, warn, debug } from "../lib/logger.js";
import { createTMDBClient } from "../tmdb/client.js";
import { extractAllMetadata } from "../tmdb/extractors.js";
import { generateEmbeddingsForTitle } from "../embeddings/generator.js";
import {
  diagnoseMissingTMDBFields,
  buildTMDBRepairStatus,
  filterTMDBRepairCandidates,
  shouldRetry,
} from "../lib/repair-utils.js";

const SUPABASE_PAGE_SIZE = 1000;

// Columns needed for TMDB repair (includes enrichment fields for embedding regeneration)
const TMDB_REPAIR_COLUMNS = `
  id, kind, title, release_date, overview, tagline, director, creators,
  cast, writers, keywords, genres, certification, runtime_minutes,
  vibes, tone, pacing, themes, profile_string,
  tmdb_repair_status, tmdb_repair_attempted_at, tmdb_repair_error
`.replace(/\s+/g, "");

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: 2000,
    dryRun: false,
    moviesOnly: false,
    tvOnly: false,
    field: null,
    retryErrors: false,
    resume: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--movies-only") {
      options.moviesOnly = true;
    } else if (arg === "--tv-only") {
      options.tvOnly = true;
    } else if (arg === "--field" && args[i + 1]) {
      options.field = args[++i];
    } else if (arg === "--retry-errors") {
      options.retryErrors = true;
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
TMDB Repair Pipeline
Repairs titles with missing TMDB metadata

Usage: node repair-tmdb-pipeline.js [options]

Options:
  --limit <n>       Maximum titles to process (default: 2000)
  --dry-run         Preview only, no changes
  --movies-only     Only process movies
  --tv-only         Only process TV shows
  --field <name>    Target specific field (overview, director, cast, etc.)
  --retry-errors    Re-attempt previously failed API calls
  --resume          Resume from checkpoint
  --help, -h        Show this help

Examples:
  node repair-tmdb-pipeline.js --limit 500
  node repair-tmdb-pipeline.js --movies-only --field overview
  node repair-tmdb-pipeline.js --retry-errors --limit 100
`);
}

/**
 * Find titles needing TMDB repair
 */
async function findTitlesNeedingTMDBRepair(options) {
  const supabase = getSupabase();
  const allResults = [];
  let offset = 0;

  while (allResults.length < options.limit) {
    const batchSize = Math.min(SUPABASE_PAGE_SIZE, options.limit - allResults.length);

    let query = supabase
      .from("titles")
      .select(TMDB_REPAIR_COLUMNS)
      .or(
        "overview.is.null," +
        "tagline.is.null," +
        "cast.is.null," +
        "keywords.is.null," +
        "certification.is.null," +
        "runtime_minutes.is.null"
      );

    // Filter by kind
    if (options.moviesOnly) {
      query = query.eq("kind", "movie");
    } else if (options.tvOnly) {
      query = query.eq("kind", "tv");
    }

    // Random order (no popularity bias)
    query = query.order("id", { ascending: true }).range(offset, offset + batchSize - 1);

    const { data, error: err } = await query;

    if (err) {
      throw new Error(`Failed to fetch titles: ${err.message}`);
    }

    if (!data || data.length === 0) break;

    // Filter based on retry logic and field targeting
    const candidates = filterTMDBRepairCandidates(data, {
      field: options.field,
      retryErrors: options.retryErrors,
    });

    allResults.push(...candidates);
    offset += data.length;

    if (data.length < batchSize) break;
  }

  return allResults.slice(0, options.limit);
}

/**
 * Repair a single title's TMDB metadata
 */
async function repairTitleTMDB(title, tmdb, dryRun) {
  const diagnosis = diagnoseMissingTMDBFields(title);
  const updates = {};
  let statusUpdate = null;

  try {
    // Fetch fresh data from TMDB
    const tmdbData = await tmdb.getDetails(title.id, title.kind);

    if (!tmdbData) {
      // Title deleted from TMDB
      statusUpdate = buildTMDBRepairStatus("not_found", "Title not found in TMDB");
      return { id: title.id, title: title.title, status: "not_found", updates: [] };
    }

    const extracted = extractAllMetadata(tmdbData, title.kind);
    let fieldsRepaired = 0;

    // Only update fields that were missing AND have TMDB data
    for (const field of diagnosis.missing) {
      const value = extracted[field];
      if (value !== null && value !== undefined) {
        // Handle arrays
        if (Array.isArray(value) && value.length === 0) continue;
        // Handle empty strings
        if (typeof value === "string" && value.trim() === "") continue;

        updates[field] = value;
        fieldsRepaired++;
      }
    }

    // Regenerate embeddings if any TMDB fields were updated
    // TMDB fields affect: metadata_embedding (cast, director, genres, keywords)
    //                     content_embedding (overview, profile, themes)
    if (fieldsRepaired > 0) {
      const merged = { ...title, ...updates };
      debug(`Regenerating embeddings for: ${title.title}`);
      const embeddings = await generateEmbeddingsForTitle(merged);

      if (embeddings.metadata) {
        updates.metadata_embedding = embeddings.metadata;
      }
      if (embeddings.content) {
        updates.content_embedding = embeddings.content;
      }
      // Also refresh vibe_embedding to keep all in sync
      if (embeddings.vibe) {
        updates.vibe_embedding = embeddings.vibe;
      }
    }

    // Determine status
    if (fieldsRepaired === 0) {
      statusUpdate = buildTMDBRepairStatus("no_data", "TMDB has no data for missing fields");
    } else {
      statusUpdate = buildTMDBRepairStatus("success");
    }

    // Apply updates
    if (!dryRun && (Object.keys(updates).length > 0 || statusUpdate)) {
      await updateTitle(title.id, { ...updates, ...statusUpdate });
    }

    return {
      id: title.id,
      title: title.title,
      status: statusUpdate?.tmdb_repair_status || "success",
      updates: Object.keys(updates).filter(k => !k.includes("embedding") && !k.includes("repair")),
      embeddingsRefreshed: fieldsRepaired > 0,
      missing: diagnosis.missing,
    };
  } catch (err) {
    // Network or API error
    statusUpdate = buildTMDBRepairStatus("api_error", err.message);

    if (!dryRun) {
      await updateTitle(title.id, statusUpdate);
    }

    return {
      id: title.id,
      title: title.title,
      status: "api_error",
      error: err.message,
      updates: [],
    };
  }
}

/**
 * Run the TMDB repair pipeline
 */
async function run() {
  const options = parseArgs();

  initFileLogging("repair-tmdb");
  info("Starting TMDB repair pipeline", options);

  // Create rate limiter and client
  const tmdbRateLimiter = createTMDBRateLimiter();
  const tmdb = createTMDBClient(tmdbRateLimiter);

  // Find titles needing repair
  info("Finding titles needing TMDB repair...");
  const titles = await findTitlesNeedingTMDBRepair(options);
  info(`Found ${titles.length} titles needing TMDB repair`);

  if (titles.length === 0) {
    info("No titles need TMDB repair");
    closeFileLogging();
    return;
  }

  // Dry run mode
  if (options.dryRun) {
    info("=== DRY RUN ===");
    const sample = titles.slice(0, 20);
    for (const t of sample) {
      const diagnosis = diagnoseMissingTMDBFields(t);
      info(`  ${t.title} (${t.id}): missing ${diagnosis.missing.join(", ")}`);
    }
    if (titles.length > 20) {
      info(`  ... and ${titles.length - 20} more`);
    }
    closeFileLogging();
    return;
  }

  // Progress tracking
  const progress = new ProgressTracker("repair-tmdb");

  if (options.resume && progress.loadCheckpoint()) {
    info("Resumed from checkpoint", progress.getSummary());
  }

  progress.setTotal(titles.length);

  // Stats by status
  const stats = {
    success: 0,
    not_found: 0,
    no_data: 0,
    api_error: 0,
  };

  // Process titles
  for (const title of titles) {
    if (progress.isProcessed(title.id)) {
      progress.recordSkip(title.id);
      continue;
    }

    try {
      const result = await repairTitleTMDB(title, tmdb, false);

      stats[result.status] = (stats[result.status] || 0) + 1;

      if (result.status === "success" && result.updates.length > 0) {
        info(`Repaired: ${title.title} -> ${result.updates.join(", ")}`);
        progress.recordSuccess(title.id);
      } else if (result.status === "not_found") {
        warn(`Not found: ${title.title}`);
        progress.recordFailure(title.id);
      } else if (result.status === "no_data") {
        debug(`No TMDB data: ${title.title}`);
        progress.recordFailure(title.id);
      } else if (result.status === "api_error") {
        error(`API error: ${title.title} - ${result.error}`);
        progress.recordFailure(title.id);
      } else {
        progress.recordSuccess(title.id);
      }

      // Print progress periodically
      if (progress.processed % 100 === 0) {
        progress.printProgress();
      }
    } catch (err) {
      error(`Error processing ${title.title}`, { error: err.message });
      progress.recordFailure(title.id);
    }
  }

  // Final summary
  progress.saveCheckpoint();
  info("=== TMDB Repair Complete ===");
  info("Results:", stats);
  progress.printProgress();

  closeFileLogging();
}

// Run the pipeline
run().catch((err) => {
  error("Pipeline failed", { error: err.message });
  process.exit(1);
});
