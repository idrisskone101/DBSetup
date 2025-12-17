/**
 * Embeddings Repair Pipeline
 * Regenerates embeddings for enriched titles
 */

import "dotenv/config";
import { getSupabase, updateTitle } from "../lib/supabase.js";
import { ProgressTracker } from "../lib/progress.js";
import { initFileLogging, closeFileLogging, info, error, warn, debug } from "../lib/logger.js";
import { generateEmbeddingsForTitle } from "../embeddings/generator.js";

const SUPABASE_PAGE_SIZE = 1000;

// Columns needed for embedding generation
const EMBEDDING_REPAIR_COLUMNS = `
  id, kind, title, release_date, overview, tagline, director, creators,
  cast, writers, keywords, genres, certification, runtime_minutes,
  production_countries, collection,
  vibes, tone, pacing, themes, profile_string,
  vibe_embedding, content_embedding, metadata_embedding,
  needs_enrichment
`.replace(/\s+/g, "");

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: 500,
    dryRun: false,
    moviesOnly: false,
    tvOnly: false,
    all: false,
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
    } else if (arg === "--all") {
      options.all = true;
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
Embeddings Repair Pipeline
Regenerates embeddings for enriched titles

Usage: node repair-embeddings-pipeline.js [options]

Options:
  --limit <n>       Maximum titles to process (default: 500)
  --dry-run         Preview only, no changes
  --movies-only     Only process movies
  --tv-only         Only process TV shows
  --all             Process all enriched titles (ignore needs_enrichment flag)
  --resume          Resume from checkpoint
  --help, -h        Show this help

Examples:
  node repair-embeddings-pipeline.js --limit 200
  node repair-embeddings-pipeline.js --all --movies-only
  node repair-embeddings-pipeline.js --dry-run
`);
}

/**
 * Find titles needing embedding regeneration
 */
async function findTitlesNeedingEmbeddings(options) {
  const supabase = getSupabase();
  const allResults = [];
  let offset = 0;

  while (allResults.length < options.limit) {
    const batchSize = Math.min(SUPABASE_PAGE_SIZE, options.limit - allResults.length);

    let query = supabase
      .from("titles")
      .select(EMBEDDING_REPAIR_COLUMNS)
      .eq("enrichment_status", "enriched");

    // Default: only process titles where needs_enrichment = true
    if (!options.all) {
      query = query.eq("needs_enrichment", true);
    }

    // Filter by kind
    if (options.moviesOnly) {
      query = query.eq("kind", "movie");
    } else if (options.tvOnly) {
      query = query.eq("kind", "tv");
    }

    query = query.order("id", { ascending: true }).range(offset, offset + batchSize - 1);

    const { data, error: err } = await query;

    if (err) {
      throw new Error(`Failed to fetch titles: ${err.message}`);
    }

    if (!data || data.length === 0) break;

    allResults.push(...data);
    offset += data.length;

    if (data.length < batchSize) break;
  }

  return allResults.slice(0, options.limit);
}

/**
 * Regenerate embeddings for a single title
 */
async function regenerateEmbeddings(title, dryRun) {
  const updates = {};

  try {
    debug(`Regenerating embeddings for: ${title.title}`);
    const embeddings = await generateEmbeddingsForTitle(title);

    if (embeddings.vibe) {
      updates.vibe_embedding = embeddings.vibe;
    }
    if (embeddings.content) {
      updates.content_embedding = embeddings.content;
    }
    if (embeddings.metadata) {
      updates.metadata_embedding = embeddings.metadata;
    }

    // Mark as no longer needing enrichment
    updates.needs_enrichment = false;

    // Apply updates
    if (!dryRun && Object.keys(updates).length > 0) {
      await updateTitle(title.id, updates);
    }

    const embeddingCount = [embeddings.vibe, embeddings.content, embeddings.metadata].filter(Boolean).length;

    return {
      id: title.id,
      title: title.title,
      status: "success",
      embeddingsGenerated: embeddingCount,
    };
  } catch (err) {
    return {
      id: title.id,
      title: title.title,
      status: "error",
      error: err.message,
    };
  }
}

/**
 * Run the embeddings repair pipeline
 */
async function run() {
  const options = parseArgs();

  initFileLogging("repair-embeddings");
  info("Starting embeddings repair pipeline", options);

  // Find titles needing embeddings
  info("Finding titles needing embedding regeneration...");
  const titles = await findTitlesNeedingEmbeddings(options);
  info(`Found ${titles.length} titles needing embedding regeneration`);

  if (titles.length === 0) {
    info("No titles need embedding regeneration");
    closeFileLogging();
    return;
  }

  // Dry run mode
  if (options.dryRun) {
    info("=== DRY RUN ===");
    const sample = titles.slice(0, 20);
    for (const t of sample) {
      const hasVibes = t.vibes && Object.keys(t.vibes).length > 0;
      const hasThemes = t.themes && t.themes.length > 0;
      info(`  ${t.title} (${t.id}): vibes=${hasVibes}, themes=${hasThemes}`);
    }
    if (titles.length > 20) {
      info(`  ... and ${titles.length - 20} more`);
    }
    closeFileLogging();
    return;
  }

  // Progress tracking
  const progress = new ProgressTracker("repair-embeddings");

  if (options.resume && progress.loadCheckpoint()) {
    info("Resumed from checkpoint", progress.getSummary());
  }

  progress.setTotal(titles.length);

  // Stats
  const stats = {
    success: 0,
    error: 0,
  };

  // Process titles
  for (const title of titles) {
    if (progress.isProcessed(title.id)) {
      progress.recordSkip(title.id);
      continue;
    }

    try {
      const result = await regenerateEmbeddings(title, false);

      stats[result.status] = (stats[result.status] || 0) + 1;

      if (result.status === "success") {
        info(`Regenerated: ${title.title} (${result.embeddingsGenerated} embeddings)`);
        progress.recordSuccess(title.id);
      } else {
        error(`Error: ${title.title} - ${result.error}`);
        progress.recordFailure(title.id);
      }

      // Print progress periodically
      if (progress.processed % 50 === 0) {
        progress.printProgress();
      }
    } catch (err) {
      error(`Error processing ${title.title}`, { error: err.message });
      progress.recordFailure(title.id);
    }
  }

  // Final summary
  progress.saveCheckpoint();
  info("=== Embeddings Repair Complete ===");
  info("Results:", stats);
  progress.printProgress();

  closeFileLogging();
}

// Run the pipeline
run().catch((err) => {
  error("Pipeline failed", { error: err.message });
  process.exit(1);
});
