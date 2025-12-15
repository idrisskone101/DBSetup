/**
 * Refresh Pipeline
 * Re-fetch TMDB metadata for existing titles in the database
 */

import { fetchTitles, updateTitle, getTitleCount } from "../lib/supabase.js";
import { createTMDBRateLimiter } from "../lib/rate-limiter.js";
import { ProgressTracker } from "../lib/progress.js";
import { initFileLogging, closeFileLogging, info, error, warn } from "../lib/logger.js";
import { createTMDBClient } from "../tmdb/client.js";
import { extractAllMetadata } from "../tmdb/extractors.js";

/**
 * Parse command line arguments
 * @returns {Object}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: null, // null = process all titles
    offset: 0,
    kind: null,
    resume: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === "--offset" && args[i + 1]) {
      options.offset = parseInt(args[++i], 10);
    } else if (arg === "--movies-only") {
      options.kind = "movie";
    } else if (arg === "--tv-only") {
      options.kind = "tv";
    } else if (arg === "--resume") {
      options.resume = true;
    }
  }

  return options;
}

/**
 * Run the refresh pipeline
 */
async function run() {
  const options = parseArgs();

  initFileLogging("refresh");
  info("Starting refresh pipeline", options);

  const progress = new ProgressTracker("refresh");

  // Load checkpoint if resuming
  if (options.resume) {
    if (progress.loadCheckpoint()) {
      info(`Resuming from checkpoint: ${progress.processed} already processed`);
    }
  }

  // Get total count
  const totalCount = await getTitleCount({ kind: options.kind });
  const availableTitles = totalCount - options.offset;
  progress.setTotal(options.limit ? Math.min(availableTitles, options.limit) : availableTitles);

  info(`Found ${totalCount} titles, processing ${progress.totalItems}`);

  // Create TMDB client
  const rateLimiter = createTMDBRateLimiter();
  const tmdb = createTMDBClient(rateLimiter);

  // Fetch titles to process
  const titles = await fetchTitles({
    limit: options.limit,
    offset: options.offset,
    kind: options.kind,
  });

  info(`Fetched ${titles.length} titles from database`);

  // Process each title
  for (const title of titles) {
    // Skip if already processed (resume mode)
    if (progress.isProcessed(title.id)) {
      continue;
    }

    try {
      info(`Processing: ${title.title} (${title.id})`);

      // Fetch fresh TMDB data
      const tmdbData = await tmdb.getDetails(title.id, title.kind);

      if (!tmdbData) {
        warn(`TMDB data not found for: ${title.title} (${title.id})`);
        progress.recordFailure(title.id);
        continue;
      }

      // Extract all metadata
      const extracted = extractAllMetadata(tmdbData, title.kind);

      // Update database (only columns that exist)
      await updateTitle(title.id, {
        title: extracted.title,
        original_title: extracted.original_title,
        overview: extracted.overview,
        tagline: extracted.tagline,
        release_date: extracted.release_date,
        popularity: extracted.popularity,
        vote_average: extracted.vote_average,
        vote_count: extracted.vote_count,
        runtime_minutes: extracted.runtime_minutes,
        poster_path: extracted.poster_path,
        backdrop_path: extracted.backdrop_path,
        cast: extracted.cast,
        director: extracted.director,
        creators: extracted.creators,
        writers: extracted.writers,
        genres: extracted.genres,
        keywords: extracted.keywords,
        certification: extracted.certification,
        production_countries: extracted.production_countries,
        collection_id: extracted.collection_id,
        collection_name: extracted.collection_name,
      });

      progress.recordSuccess(title.id);

      // Print progress every 100 items
      if (progress.processed % 100 === 0) {
        progress.printProgress();
      }
    } catch (err) {
      error(`Error processing ${title.title} (${title.id})`, { error: err.message });
      progress.recordFailure(title.id);
    }
  }

  // Final checkpoint
  progress.saveCheckpoint();

  // Print summary
  info("Refresh pipeline completed", progress.getSummary());
  progress.printProgress();

  closeFileLogging();
}

// Run the pipeline
run().catch((err) => {
  error("Pipeline failed", { error: err.message });
  process.exit(1);
});
