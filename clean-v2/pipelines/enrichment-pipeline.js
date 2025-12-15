/**
 * Enrichment Pipeline
 * Re-enrich titles with validated Wikipedia data + LLM extraction + embeddings
 */

import { fetchTitles, updateTitle, getTitleCount } from "../lib/supabase.js";
import { createWikipediaRateLimiter } from "../lib/rate-limiter.js";
import { ProgressTracker } from "../lib/progress.js";
import { initFileLogging, closeFileLogging, info, error, warn, debug } from "../lib/logger.js";
import { createWikipediaFetcher } from "../wikipedia/fetcher.js";
import { extractVibes, extractVibesFromOverview } from "../enrichment/vibe-extractor.js";
import { extractThemes, extractThemesFromOverview } from "../enrichment/theme-extractor.js";
import { generateProfile, generateProfileFromOverview } from "../enrichment/profile-generator.js";
import { generateEmbeddingsForTitle } from "../embeddings/generator.js";

/**
 * Parse command line arguments
 * @returns {Object}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: null, // null = process all titles
    force: false,
    resume: false,
    kind: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--movies-only") {
      options.kind = "movie";
    } else if (arg === "--tv-only") {
      options.kind = "tv";
    }
  }

  return options;
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
    kind: options.kind,
  };

  // If not forcing, only get titles that need enrichment
  if (!options.force) {
    fetchOptions.needsEnrichment = true;
  }

  const totalCount = await getTitleCount(fetchOptions);
  progress.setTotal(options.limit ? Math.min(totalCount, options.limit) : totalCount);

  info(`Found ${totalCount} titles needing enrichment, processing ${progress.totalItems}`);

  // Fetch titles
  const titles = await fetchTitles(fetchOptions);
  info(`Fetched ${titles.length} titles from database`);

  // Create Wikipedia fetcher
  const wikiRateLimiter = createWikipediaRateLimiter();
  const wikipedia = createWikipediaFetcher(wikiRateLimiter);

  // Process each title
  for (const title of titles) {
    // Skip if already processed (resume mode)
    if (progress.isProcessed(title.id)) {
      continue;
    }

    try {
      info(`Enriching: ${title.title} (${title.id})`);

      const year = getYear(title.release_date);
      const updates = {};

      // Step 1: Fetch Wikipedia content with validation
      const wikiResult = await wikipedia.fetchForTitle(
        title.title,
        year,
        title.kind,
        {
          director: title.director,
          cast: title.cast,
        }
      );

      let content = null;
      if (wikiResult) {
        content = wikiResult.content;
        updates.wiki_source_url = wikiResult.url;
        debug(`Wikipedia found (confidence: ${wikiResult.confidence})`);
      } else {
        debug("No valid Wikipedia article found, using overview only");
        updates.wiki_source_url = null;
      }

      // Step 2: Extract vibes, tone, pacing
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

      if (Object.keys(vibeResult.vibes).length > 0) {
        updates.vibes = vibeResult.vibes;
      }
      if (vibeResult.tone) {
        updates.tone = vibeResult.tone;
      }
      if (vibeResult.pacing) {
        updates.pacing = vibeResult.pacing;
      }

      // Step 3: Extract themes
      let themes;
      if (content) {
        themes = await extractThemes(content, title.title);
      } else {
        themes = await extractThemesFromOverview(title.overview, title.title, title.genres);
      }

      if (themes.length > 0) {
        updates.themes = themes;
      }

      // Step 4: Generate profile string
      let profile;
      if (content) {
        profile = await generateProfile(content, title.title, title.overview);
      } else {
        profile = await generateProfileFromOverview(title.overview, title.title, title.genres);
      }

      if (profile) {
        updates.profile_string = profile;
      }

      // Merge updates into title for embedding generation
      const enrichedTitle = { ...title, ...updates };

      // Step 5: Generate embeddings
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

      // Step 6: Update database
      updates.enriched_at = new Date().toISOString();
      await updateTitle(title.id, updates);

      progress.recordSuccess(title.id);

      // Print progress every 50 items
      if (progress.processed % 50 === 0) {
        progress.printProgress();
      }
    } catch (err) {
      error(`Error enriching ${title.title} (${title.id})`, { error: err.message });
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
