/**
 * Enrichment Pipeline
 * Re-enrich titles with validated Wikipedia data + LLM extraction + embeddings
 * Supports streaming pagination for 50k+ titles
 */

import { getSupabase, updateTitle, getTitleCount } from "../lib/supabase.js";
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
import { diagnoseEnrichmentNeeds, hasSparseVibes } from "../lib/repair-utils.js";

const SUPABASE_PAGE_SIZE = 1000;

// Columns needed for enrichment (excludes heavy embeddings to avoid timeout)
const ENRICHMENT_COLUMNS = `
  id, kind, title, release_date, overview, genres, director, cast,
  wiki_source_url, vibes, tone, pacing, themes, profile_string, slots,
  enrichment_status, enriched_at, needs_enrichment
`.replace(/\s+/g, "");

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
    embeddingsOnly: false, // Only regenerate embeddings, skip LLM extraction
    sparseVibesOnly: false, // Only re-enrich titles with < 32 vibes
    reEnrichMissing: false, // Re-enrich titles missing any fields
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
    } else if (arg === "--embeddings-only") {
      options.embeddingsOnly = true;
      options.all = true; // Need to check already-enriched titles
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--movies-only") {
      options.kind = "movie";
    } else if (arg === "--tv-only") {
      options.kind = "tv";
    } else if (arg === "--sparse-vibes-only") {
      options.sparseVibesOnly = true;
      options.all = true; // Need to check already-enriched titles
    } else if (arg === "--re-enrich-missing") {
      options.reEnrichMissing = true;
      options.all = true;
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
Supports streaming pagination for 50k+ titles

Usage: node enrichment-pipeline.js [options]

Options:
  --limit <n>          Maximum titles to process (default: all)
  --offset <n>         Skip first N titles
  --all                Process ALL titles (default: only non-enriched)
  --skip-embeddings    Skip embedding generation (run separately later)
  --embeddings-only    Only regenerate embeddings, skip LLM extraction
  --resume             Resume from checkpoint
  --movies-only        Only process movies
  --tv-only            Only process TV shows
  --sparse-vibes-only  Only re-enrich titles with < 32 vibes
  --re-enrich-missing  Re-enrich titles missing vibes/themes/profile/slots
  --help, -h           Show this help

Examples:
  node enrichment-pipeline.js --limit 50000
  node enrichment-pipeline.js --limit 1000 --movies-only
  node enrichment-pipeline.js --all --limit 500  # Re-enrich existing
  node enrichment-pipeline.js --sparse-vibes-only --limit 100
  node enrichment-pipeline.js --embeddings-only --limit 1000  # Just embeddings
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
 * Fetch a batch of titles for processing (streaming pagination)
 * @param {Object} options
 * @param {number} offset - Current offset
 * @param {number} batchSize - Batch size
 * @returns {Promise<Array>}
 */
async function fetchTitleBatch(options, offset, batchSize) {
  const supabase = getSupabase();

  let query = supabase
    .from("titles")
    .select(ENRICHMENT_COLUMNS)
    .order("id", { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (options.kind) {
    query = query.eq("kind", options.kind);
  }

  // Default: only non-enriched (unless --all, --sparse-vibes-only, or --re-enrich-missing)
  if (!options.all) {
    query = query.or("enrichment_status.is.null,enrichment_status.neq.enriched");
  }

  const { data, error: err } = await query;

  if (err) {
    throw new Error(`Failed to fetch titles: ${err.message}`);
  }

  return data || [];
}

/**
 * Filter titles based on enrichment mode
 * @param {Array} titles
 * @param {Object} options
 * @returns {Array}
 */
function filterTitlesForEnrichment(titles, options) {
  if (options.embeddingsOnly) {
    // Only process titles that have enrichment data but need embeddings
    return titles.filter((t) => {
      const hasEnrichmentData = t.vibes && t.themes && t.profile_string;
      const diagnosis = diagnoseEnrichmentNeeds(t);
      const needsEmbeddings = diagnosis.missing.some((f) => f.includes("embedding"));
      const flaggedForEnrichment = t.needs_enrichment === true;
      return hasEnrichmentData && (needsEmbeddings || flaggedForEnrichment);
    });
  }

  if (options.sparseVibesOnly) {
    return titles.filter((t) => hasSparseVibes(t.vibes));
  }

  if (options.reEnrichMissing) {
    return titles.filter((t) => {
      const diagnosis = diagnoseEnrichmentNeeds(t);
      return diagnosis.hasMissing;
    });
  }

  return titles;
}

/**
 * Run the enrichment pipeline with streaming pagination
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

  // Get total count for progress tracking
  const totalCount = await getTitleCount({ kind: options.kind, notEnriched: !options.all });
  const targetCount = options.limit || totalCount - options.offset;
  info(`Found ${totalCount} titles total, targeting up to ${targetCount} titles`);

  // Create rate limiters
  const wikiRateLimiter = createWikipediaRateLimiter();
  const openaiRateLimiter = createOpenAIRateLimiter(150); // 150ms between OpenAI calls
  const wikipedia = createWikipediaFetcher(wikiRateLimiter);

  // Streaming pagination: fetch and process in batches
  let currentOffset = options.offset;
  let totalProcessed = 0;
  const maxToProcess = options.limit || Infinity;

  while (totalProcessed < maxToProcess) {
    // Fetch next batch
    const batchSize = Math.min(SUPABASE_PAGE_SIZE, maxToProcess - totalProcessed);
    const batch = await fetchTitleBatch(options, currentOffset, batchSize);

    if (batch.length === 0) {
      info("No more titles to fetch");
      break;
    }

    // Filter based on mode (sparse vibes, missing fields, etc.)
    const titlesToProcess = filterTitlesForEnrichment(batch, options);

    if (titlesToProcess.length === 0 && batch.length > 0) {
      // All titles in batch were filtered out, move to next batch
      currentOffset += batch.length;
      continue;
    }

    info(`Fetched batch of ${batch.length}, processing ${titlesToProcess.length} after filtering`);
    progress.setTotal(progress.totalItems + titlesToProcess.length);

    // Process each title in batch
    for (const title of titlesToProcess) {
      if (totalProcessed >= maxToProcess) break;

      // Skip if already processed (resume mode)
      if (progress.isProcessed(title.id)) {
        continue;
      }

      const errors = [];
      const updates = {};

      try {
        info(`Enriching: ${title.title} (${title.id})`);

        // Run diagnosis to see what's needed (for re-enrich modes)
        const diagnosis = diagnoseEnrichmentNeeds(title);
        const needsVibes = !title.vibes || hasSparseVibes(title.vibes) || diagnosis.missing.includes("vibes");
        const needsThemes = !title.themes || title.themes.length === 0;
        const needsProfile = !title.profile_string;
        const needsSlots = !title.slots;

        const year = getYear(title.release_date);
        let content = null;

        // Skip LLM extraction steps if --embeddings-only mode
        if (!options.embeddingsOnly) {
          // Step 1: Fetch Wikipedia content with validation
          if (!title.wiki_source_url) {
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
          } else if (title.wiki_source_url) {
            // Fetch existing wiki content for LLM extraction
            try {
              content = await fetchWikipediaContent(title.wiki_source_url, wikiRateLimiter);
            } catch (err) {
              debug(`Failed to fetch existing wiki content: ${err.message}`);
            }
          }

          // Step 2: Extract vibes, tone, pacing (if needed or sparse)
          if (needsVibes || !title.tone || !title.pacing) {
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

              // Always update vibes to ensure 32 dimensions
              if (vibeResult && Object.keys(vibeResult.vibes).length === 32) {
                updates.vibes = vibeResult.vibes;
              }
              if (vibeResult?.tone && !title.tone) {
                updates.tone = vibeResult.tone;
              }
              if (vibeResult?.pacing && !title.pacing) {
                updates.pacing = vibeResult.pacing;
              }
            } catch (err) {
              errors.push(`vibes: ${err.message}`);
              warn(`Vibes extraction error for ${title.title}: ${err.message}`);
            }
          }

          // Step 3: Extract themes (if needed)
          if (needsThemes) {
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
          }

          // Step 4: Generate profile string (if needed)
          if (needsProfile) {
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
          }

          // Step 5: Extract slots (if needed)
          if (needsSlots) {
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
          }
        } // End of LLM extraction steps

        // Step 6: Generate embeddings (unless --skip-embeddings)
        // Always regenerate when enrichment data changes or in embeddings-only mode
        if (!options.skipEmbeddings) {
          const enrichmentChanged = updates.vibes || updates.tone || updates.pacing ||
            updates.themes || updates.profile_string || updates.wiki_source_url;

          // In embeddings-only mode, always regenerate; otherwise check if needed
          const shouldGenerateEmbeddings = options.embeddingsOnly ||
            enrichmentChanged ||
            diagnosis.missing.some((f) => f.includes("embedding"));

          if (shouldGenerateEmbeddings) {
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
        }

        // Step 7: Determine status and update database
        if (errors.length === 0) {
          updates.enrichment_status = "enriched";
        } else if (Object.keys(updates).length > 1) {
          // Some fields succeeded
          updates.enrichment_status = "enriched";
          warn(`Partial enrichment for ${title.title}: ${errors.join("; ")}`);
        } else {
          updates.enrichment_status = "failed";
          error(`Failed enrichment for ${title.title}: ${errors.join("; ")}`);
        }

        updates.enriched_at = new Date().toISOString();

        // Handle needs_enrichment flag
        const enrichmentDataChanged = updates.vibes || updates.themes || updates.profile_string || updates.tone || updates.pacing;
        const embeddingsGenerated = updates.vibe_embedding || updates.content_embedding || updates.metadata_embedding;

        if (options.embeddingsOnly && embeddingsGenerated) {
          // Embeddings-only mode: clear flag since we just regenerated embeddings
          updates.needs_enrichment = false;
        } else if (enrichmentDataChanged) {
          if (options.skipEmbeddings) {
            // Signal that embeddings need to be regenerated later
            updates.needs_enrichment = true;
          } else if (embeddingsGenerated) {
            // Embeddings were regenerated, clear the flag
            updates.needs_enrichment = false;
          }
        }

        await updateTitle(title.id, updates);

        progress.recordSuccess(title.id);
        totalProcessed++;

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
        totalProcessed++;
      }
    }

    // Move to next batch
    currentOffset += batch.length;

    // Save checkpoint after each batch
    progress.saveCheckpoint();
  }

  // Final summary
  info("Enrichment pipeline completed", progress.getSummary());
  progress.printProgress();

  closeFileLogging();
}

// Run the pipeline
run().catch((err) => {
  error("Pipeline failed", { error: err.message });
  process.exit(1);
});
