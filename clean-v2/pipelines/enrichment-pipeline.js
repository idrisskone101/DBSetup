/**
 * Enrichment Pipeline
 * Re-enrich titles with validated Wikipedia data + LLM extraction + embeddings
 */

import { fetchTitles, updateTitle, getTitleCount } from "../lib/supabase.js";
import { createWikipediaRateLimiter, createOpenAIRateLimiter } from "../lib/rate-limiter.js";
import { ProgressTracker } from "../lib/progress.js";
import { initFileLogging, closeFileLogging, info, error, warn, debug } from "../lib/logger.js";
import { createWikipediaFetcher } from "../wikipedia/fetcher.js";
import { fetchWikipediaContent } from "../wikipedia/content-fetcher.js";
import { extractVibes, extractVibesFromOverview } from "../enrichment/vibe-extractor.js";
import { extractThemes, extractThemesFromOverview } from "../enrichment/theme-extractor.js";
import { generateProfile, generateProfileFromOverview } from "../enrichment/profile-generator.js";
import { extractSlots, extractSlotsFromOverview } from "../enrichment/slot-extractor.js";
import { generateEmbeddingsForTitle } from "../embeddings/generator.js";

/**
 * Parse command line arguments
 * @returns {Object}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: null, // null = process all titles
    offset: 0,
    resume: false,
    kind: null,
    all: false, // Process all titles regardless of status
    skipEmbeddings: false, // Skip embedding generation
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === "--offset" && args[i + 1]) {
      options.offset = parseInt(args[++i], 10);
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--skip-embeddings") {
      options.skipEmbeddings = true;
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--movies-only") {
      options.kind = "movie";
    } else if (arg === "--tv-only") {
      options.kind = "tv";
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
Enrichment Pipeline
Enrich titles with Wikipedia data, LLM extraction, and embeddings

Usage: node enrichment-pipeline.js [options]

Options:
  --limit <n>         Maximum titles to process (default: all)
  --offset <n>        Skip first N titles
  --all               Process ALL titles (default: only non-enriched)
  --skip-embeddings   Skip embedding generation
  --resume            Resume from checkpoint
  --movies-only       Only process movies
  --tv-only           Only process TV shows
  --help, -h          Show this help

Examples:
  node enrichment-pipeline.js --limit 50000
  node enrichment-pipeline.js --limit 1000 --movies-only
  node enrichment-pipeline.js --all --limit 500  # Re-enrich existing
`);
}

/**
 * Get year from release date
 * @param {string} releaseDate
 * @returns {string}
 */
function getYear(releaseDate) {
  if (!releaseDate) return "";
  return releaseDate.slice(0, 4);
}

/**
 * Run the enrichment pipeline
 */
async function run() {
  const options = parseArgs();

  initFileLogging("enrichment");
  info("Starting enrichment pipeline", options);

  const progress = new ProgressTracker("enrichment");

  // Load checkpoint if resuming
  if (options.resume) {
    if (progress.loadCheckpoint()) {
      info(`Resuming from checkpoint: ${progress.processed} already processed`);
    }
  }

  // Get titles to process
  const fetchOptions = {
    limit: options.limit,
    offset: options.offset,
    kind: options.kind,
  };

  // Default: only fetch non-enriched titles (unless --all flag)
  if (!options.all) {
    fetchOptions.notEnriched = true;
  }

  // Get total count for progress tracking
  const totalCount = await getTitleCount({ kind: options.kind, notEnriched: !options.all });
  const availableTitles = totalCount - options.offset;
  progress.setTotal(options.limit ? Math.min(availableTitles, options.limit) : availableTitles);

  info(`Found ${totalCount} titles total, starting at offset ${options.offset}, processing ${progress.totalItems}`);

  // Fetch titles with pagination
  const titles = await fetchTitles(fetchOptions);
  info(`Fetched ${titles.length} titles from database`);

  // Create rate limiters
  const wikiRateLimiter = createWikipediaRateLimiter();
  const openaiRateLimiter = createOpenAIRateLimiter(150); // 150ms between OpenAI calls
  const wikipedia = createWikipediaFetcher(wikiRateLimiter);

  // Process each title
  for (const title of titles) {
    // Skip if already processed (resume mode)
    if (progress.isProcessed(title.id)) {
      continue;
    }

    const errors = [];
    const updates = {};

    try {
      info(`Enriching: ${title.title} (${title.id})`);

      const year = getYear(title.release_date);
      let content = null;

      // Step 1: Fetch Wikipedia content with validation
      try {
        const wikiResult = await wikipedia.fetchForTitle(
          title.title,
          year,
          title.kind,
          {
            director: title.director,
            cast: title.cast,
          }
        );

        if (wikiResult) {
          content = wikiResult.content;
          updates.wiki_source_url = wikiResult.url;
          debug(`Wikipedia found (confidence: ${wikiResult.confidence})`);
        } else {
          debug("No valid Wikipedia article found, using overview only");
          updates.wiki_source_url = null;
        }
      } catch (err) {
        errors.push(`wiki: ${err.message}`);
        warn(`Wikipedia error for ${title.title}: ${err.message}`);
      }

      // Step 2: Extract vibes, tone, pacing
      try {
        await openaiRateLimiter.acquire();
        let vibeResult;
        if (content) {
          vibeResult = await extractVibes(content, title.title, title.kind);
        } else {
          vibeResult = await extractVibesFromOverview(
            title.overview,
            title.title,
            title.kind,
            title.genres
          );
        }

        if (vibeResult && Object.keys(vibeResult.vibes).length > 0) {
          updates.vibes = vibeResult.vibes;
        }
        if (vibeResult?.tone) {
          updates.tone = vibeResult.tone;
        }
        if (vibeResult?.pacing) {
          updates.pacing = vibeResult.pacing;
        }
      } catch (err) {
        errors.push(`vibes: ${err.message}`);
        warn(`Vibes extraction error for ${title.title}: ${err.message}`);
      }

      // Step 3: Extract themes
      try {
        await openaiRateLimiter.acquire();
        let themes;
        if (content) {
          themes = await extractThemes(content, title.title);
        } else {
          themes = await extractThemesFromOverview(title.overview, title.title, title.genres);
        }

        if (themes && themes.length > 0) {
          updates.themes = themes;
        }
      } catch (err) {
        errors.push(`themes: ${err.message}`);
        warn(`Themes extraction error for ${title.title}: ${err.message}`);
      }

      // Step 4: Generate profile string
      try {
        await openaiRateLimiter.acquire();
        let profile;
        if (content) {
          profile = await generateProfile(content, title.title, title.overview);
        } else {
          profile = await generateProfileFromOverview(title.overview, title.title, title.genres);
        }

        if (profile) {
          updates.profile_string = profile;
        }
      } catch (err) {
        errors.push(`profile: ${err.message}`);
        warn(`Profile generation error for ${title.title}: ${err.message}`);
      }

      // Step 5: Extract slots
      try {
        await openaiRateLimiter.acquire();
        let slots;
        if (content) {
          slots = await extractSlots(content, title.title, title.kind);
        } else {
          slots = await extractSlotsFromOverview(title.overview, title.title, title.genres);
        }

        if (slots) {
          updates.slots = slots;
        }
      } catch (err) {
        errors.push(`slots: ${err.message}`);
        warn(`Slots extraction error for ${title.title}: ${err.message}`);
      }

      // Step 6: Generate embeddings (unless --skip-embeddings)
      if (!options.skipEmbeddings) {
        try {
          const enrichedTitle = { ...title, ...updates };
          const embeddings = await generateEmbeddingsForTitle(enrichedTitle);

          if (embeddings.vibe) {
            updates.vibe_embedding = embeddings.vibe;
          }
          if (embeddings.content) {
            updates.content_embedding = embeddings.content;
          }
          if (embeddings.metadata) {
            updates.metadata_embedding = embeddings.metadata;
          }
        } catch (err) {
          errors.push(`embeddings: ${err.message}`);
          warn(`Embedding generation error for ${title.title}: ${err.message}`);
        }
      }

      // Step 7: Determine status and update database
      if (errors.length === 0) {
        updates.enrichment_status = "enriched";
      } else if (Object.keys(updates).length > 1) {
        // Some fields succeeded (more than just wiki_source_url)
        updates.enrichment_status = "enriched"; // Still mark enriched if partial success
        warn(`Partial enrichment for ${title.title}: ${errors.join("; ")}`);
      } else {
        updates.enrichment_status = "failed";
        error(`Failed enrichment for ${title.title}: ${errors.join("; ")}`);
      }

      updates.enriched_at = new Date().toISOString();
      await updateTitle(title.id, updates);

      progress.recordSuccess(title.id);

      // Print progress every 50 items
      if (progress.processed % 50 === 0) {
        progress.printProgress();
      }
    } catch (err) {
      error(`Error enriching ${title.title} (${title.id})`, { error: err.message });

      // Try to save partial progress if any updates were made
      if (Object.keys(updates).length > 0) {
        try {
          updates.enrichment_status = "failed";
          updates.enriched_at = new Date().toISOString();
          await updateTitle(title.id, updates);
        } catch (updateErr) {
          error(`Failed to save partial updates for ${title.id}`, { error: updateErr.message });
        }
      }

      progress.recordFailure(title.id);
    }
  }

  // Final checkpoint
  progress.saveCheckpoint();

  // Print summary
  info("Enrichment pipeline completed", progress.getSummary());
  progress.printProgress();

  closeFileLogging();
}

// Run the pipeline
run().catch((err) => {
  error("Pipeline failed", { error: err.message });
  process.exit(1);
});
