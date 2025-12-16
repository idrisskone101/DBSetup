/**
 * Enrichment Pipeline
 * Re-enrich titles with validated Wikipedia data + LLM extraction + embeddings
 */

import { fetchTitles, updateTitle, getTitleCount } from "../lib/supabase.js";
import { createWikipediaRateLimiter, createOpenAIRateLimiter } from "../lib/rate-limiter.js";
import { ProgressTracker } from "../lib/progress.js";
import { initFileLogging, closeFileLogging, info, error, warn, debug } from "../lib/logger.js";
import { createWikipediaFetcher } from "../wikipedia/fetcher.js";
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
    unenrichedOnly: false, // Only process titles that haven't been enriched
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === "--offset" && args[i + 1]) {
      options.offset = parseInt(args[++i], 10);
    } else if (arg === "--unenriched-only") {
      options.unenrichedOnly = true;
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
    offset: options.offset,
    kind: options.kind,
  };

  // Only filter to unenriched titles if explicitly requested
  if (options.unenrichedOnly) {
    fetchOptions.needsEnrichment = true;
  }

  // Get total count for progress tracking
  const totalCount = await getTitleCount({ kind: options.kind, needsEnrichment: options.unenrichedOnly || undefined });
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
      await openaiRateLimiter.acquire();
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

      // Step 5: Extract slots
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

      // Merge updates into title for embedding generation
      const enrichedTitle = { ...title, ...updates };

      // Step 6: Generate embeddings
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

      // Step 7: Update database
      updates.enrichment_status = "enriched";
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
