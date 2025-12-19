/**
 * Enrichment Repair Pipeline
 * Repairs enriched titles with missing fields (wiki, vibes, themes, slots, embeddings)
 */

import "dotenv/config";
import { getSupabase, updateTitle } from "../lib/supabase.js";
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
import {
  diagnoseEnrichmentNeeds,
  buildEnrichmentRepairStatus,
  filterEnrichmentRepairCandidates,
} from "../lib/repair-utils.js";

const SUPABASE_PAGE_SIZE = 1000;

// Columns needed for enrichment repair (excludes heavy embeddings to avoid timeout)
const ENRICHMENT_REPAIR_COLUMNS = `
  id, kind, title, release_date, overview, genres, director, cast,
  wiki_source_url, vibes, tone, pacing, themes, profile_string, slots,
  enrichment_repair_status, enrichment_repair_attempted_at, enrichment_repair_error
`.replace(/\s+/g, "");

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: 1000,
    dryRun: false,
    mode: "all", // 'all', 'wiki-only', 'embeddings-only'
    field: null,
    retryPartial: false,
    quickWins: false,
    resume: false,
    skipEmbeddings: false,
    sparseVibesOnly: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--wiki-only") {
      options.mode = "wiki-only";
    } else if (arg === "--embeddings-only") {
      options.mode = "embeddings-only";
    } else if (arg === "--field" && args[i + 1]) {
      options.field = args[++i];
    } else if (arg === "--retry-partial") {
      options.retryPartial = true;
    } else if (arg === "--quick-wins") {
      options.quickWins = true;
      options.mode = "embeddings-only";
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--skip-embeddings") {
      options.skipEmbeddings = true;
    } else if (arg === "--sparse-vibes-only") {
      options.sparseVibesOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
Enrichment Repair Pipeline
Repairs enriched titles with missing fields

Usage: node repair-enrichment-pipeline.js [options]

Options:
  --limit <n>         Maximum titles to process (default: 1000)
  --dry-run           Preview only, no changes
  --wiki-only         Only retry Wikipedia search
  --embeddings-only   Only regenerate missing embeddings
  --field <name>      Target specific field (vibes, themes, slots, etc.)
  --retry-partial     Re-attempt partial successes
  --quick-wins        Process embeddings-only repairs first
  --resume            Resume from checkpoint
  --skip-embeddings   Skip embedding regeneration (faster, run repair-embeddings separately)
  --sparse-vibes-only Only re-enrich titles with < 32 vibes
  --help, -h          Show this help

Examples:
  node repair-enrichment-pipeline.js --limit 500
  node repair-enrichment-pipeline.js --embeddings-only --limit 200
  node repair-enrichment-pipeline.js --wiki-only --retry-partial
`);
}

/**
 * Get year from release date
 */
function getYear(releaseDate) {
  if (!releaseDate) return "";
  return releaseDate.slice(0, 4);
}

/**
 * Find enriched titles needing repair
 */
async function findTitlesNeedingEnrichmentRepair(options) {
  const supabase = getSupabase();
  const allResults = [];
  let offset = 0;

  while (allResults.length < options.limit) {
    const batchSize = Math.min(SUPABASE_PAGE_SIZE, options.limit - allResults.length);

    let query = supabase
      .from("titles")
      .select(ENRICHMENT_REPAIR_COLUMNS)
      .eq("enrichment_status", "enriched")
      .or(
        "vibes.is.null," +
        "themes.is.null," +
        "tone.is.null," +
        "pacing.is.null," +
        "profile_string.is.null," +
        "slots.is.null," +
        "vibe_embedding.is.null," +
        "content_embedding.is.null," +
        "metadata_embedding.is.null"
      )
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    const { data, error: err } = await query;

    if (err) {
      throw new Error(`Failed to fetch titles: ${err.message}`);
    }

    if (!data || data.length === 0) break;

    // Filter based on mode and retry logic
    const candidates = filterEnrichmentRepairCandidates(data, {
      mode: options.mode,
      field: options.field,
      retryPartial: options.retryPartial,
    });

    allResults.push(...candidates);
    offset += data.length;

    if (data.length < batchSize) break;
  }

  return allResults.slice(0, options.limit);
}

/**
 * Find enriched titles with sparse vibes (< 32 dimensions)
 */
async function findTitlesWithSparseVibes(limit) {
  const supabase = getSupabase();
  const allResults = [];
  let offset = 0;

  // Fetch in batches, filter in JS since Supabase can't count jsonb keys
  while (allResults.length < limit) {
    const batchSize = Math.min(SUPABASE_PAGE_SIZE, (limit - allResults.length) * 2);

    const { data, error: err } = await supabase
      .from("titles")
      .select(ENRICHMENT_REPAIR_COLUMNS)
      .eq("enrichment_status", "enriched")
      .not("vibes", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (err) {
      throw new Error(`Failed to fetch titles: ${err.message}`);
    }

    if (!data || data.length === 0) break;

    // Filter to sparse vibes (< 32 keys)
    const sparse = data.filter((t) => Object.keys(t.vibes || {}).length < 32);
    allResults.push(...sparse);

    offset += data.length;

    if (data.length < batchSize) break;
  }

  return allResults.slice(0, limit);
}

/**
 * Repair a single title's enrichment data
 */
async function repairTitleEnrichment(title, rateLimiters, wikipedia, mode, dryRun, skipEmbeddings = false) {
  const { wikiRateLimiter, openaiRateLimiter } = rateLimiters;
  const diagnosis = diagnoseEnrichmentNeeds(title);
  const updates = {};
  const errors = [];
  let wikiContent = null;

  // Step 1: Wikipedia (if needed and not embeddings-only mode)
  if (mode !== "embeddings-only" && !title.wiki_source_url) {
    try {
      const year = getYear(title.release_date);
      const wikiResult = await wikipedia.fetchForTitle(title.title, year, title.kind, {
        director: title.director,
        cast: title.cast,
      });

      if (wikiResult) {
        updates.wiki_source_url = wikiResult.url;
        wikiContent = wikiResult.content;
        info(`Found Wikipedia: ${title.title} -> ${wikiResult.url}`);
      } else {
        debug(`No Wikipedia found: ${title.title}`);
      }
    } catch (err) {
      errors.push(`wiki: ${err.message}`);
      warn(`Wikipedia error for ${title.title}: ${err.message}`);
    }
  } else if (title.wiki_source_url && mode !== "embeddings-only") {
    // Fetch existing wiki content for LLM extraction
    try {
      wikiContent = await fetchWikipediaContent(title.wiki_source_url, wikiRateLimiter);
    } catch (err) {
      debug(`Failed to fetch existing wiki content: ${err.message}`);
    }
  }

  // Step 2: LLM extraction (if needed and not wiki-only or embeddings-only mode)
  if (mode === "all" || mode === "wiki-only") {
    const needsLLM = diagnosis.missing.some((f) =>
      ["vibes", "sparse_vibes", "tone", "pacing", "themes", "profile_string", "slots"].includes(f)
    );

    if (needsLLM) {
      const hasWiki = wikiContent || title.wiki_source_url;

      // Vibes/Tone/Pacing (also re-extract if sparse_vibes)
      if (diagnosis.missing.includes("vibes") || diagnosis.missing.includes("sparse_vibes") || diagnosis.missing.includes("tone") || diagnosis.missing.includes("pacing")) {
        try {
          await openaiRateLimiter.acquire();
          const vibeData = wikiContent
            ? await extractVibes(wikiContent, title.title, title.kind)
            : await extractVibesFromOverview(title.overview, title.title, title.kind, title.genres);

          if ((diagnosis.missing.includes("vibes") || diagnosis.missing.includes("sparse_vibes")) && Object.keys(vibeData.vibes).length > 0) {
            updates.vibes = vibeData.vibes;
          }
          if (diagnosis.missing.includes("tone") && vibeData.tone) {
            updates.tone = vibeData.tone;
          }
          if (diagnosis.missing.includes("pacing") && vibeData.pacing) {
            updates.pacing = vibeData.pacing;
          }
        } catch (err) {
          errors.push(`vibes: ${err.message}`);
        }
      }

      // Themes
      if (diagnosis.missing.includes("themes")) {
        try {
          await openaiRateLimiter.acquire();
          const themes = wikiContent
            ? await extractThemes(wikiContent, title.title)
            : await extractThemesFromOverview(title.overview, title.title, title.genres);

          if (themes && themes.length > 0) {
            updates.themes = themes;
          }
        } catch (err) {
          errors.push(`themes: ${err.message}`);
        }
      }

      // Profile
      if (diagnosis.missing.includes("profile_string")) {
        try {
          await openaiRateLimiter.acquire();
          const profile = wikiContent
            ? await generateProfile(wikiContent, title.title, title.overview)
            : await generateProfileFromOverview(title.overview, title.title, title.genres);

          if (profile) {
            updates.profile_string = profile;
          }
        } catch (err) {
          errors.push(`profile: ${err.message}`);
        }
      }

      // Slots
      if (diagnosis.missing.includes("slots")) {
        try {
          await openaiRateLimiter.acquire();
          const slots = wikiContent
            ? await extractSlots(wikiContent, title.title, title.kind)
            : await extractSlotsFromOverview(title.overview, title.title, title.genres);

          if (slots) {
            updates.slots = slots;
          }
        } catch (err) {
          errors.push(`slots: ${err.message}`);
        }
      }
    }
  }

  // Step 3: Embeddings - always regenerate all three when any field is updated
  // This ensures embeddings stay in sync with underlying data
  // Skip if --skip-embeddings flag is set (run repair-embeddings pipeline separately)
  if (!skipEmbeddings) {
    const enrichmentFieldsChanged = updates.vibes || updates.tone || updates.pacing ||
      updates.themes || updates.profile_string || updates.wiki_source_url;

    const needsEmbeddings =
      diagnosis.missing.includes("vibe_embedding") ||
      diagnosis.missing.includes("content_embedding") ||
      diagnosis.missing.includes("metadata_embedding");

    if (needsEmbeddings || enrichmentFieldsChanged) {
      try {
        const merged = { ...title, ...updates };
        debug(`Regenerating all embeddings for: ${title.title}`);
        const embeddings = await generateEmbeddingsForTitle(merged);

        // Always update all three embeddings when any enrichment data changes
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
      }
    }
  }

  // Determine repair status
  let statusUpdate;
  const updatedFields = Object.keys(updates).filter((k) => !k.includes("repair") && !k.includes("embedding"));
  const embeddingsRefreshed = updates.vibe_embedding || updates.content_embedding || updates.metadata_embedding;
  const allUpdatedFields = Object.keys(updates).filter((k) => !k.includes("repair"));
  const remainingMissing = diagnosis.missing.filter((f) => {
    if (f === "sparse_vibes" && allUpdatedFields.includes("vibes")) return false;
    // When --skip-embeddings, don't count embeddings as remaining (they're handled separately)
    if (skipEmbeddings && f.includes("embedding")) return false;
    return !allUpdatedFields.includes(f);
  });

  if (errors.length > 0) {
    if (errors.some((e) => e.includes("llm") || e.includes("vibes") || e.includes("themes"))) {
      statusUpdate = buildEnrichmentRepairStatus("llm_error", errors.join("; "));
    } else if (errors.some((e) => e.includes("wiki"))) {
      statusUpdate = buildEnrichmentRepairStatus("wiki_not_found", errors.join("; "));
    } else {
      statusUpdate = buildEnrichmentRepairStatus("partial", errors.join("; "));
    }
  } else if (remainingMissing.length > 0 && updatedFields.length > 0) {
    statusUpdate = buildEnrichmentRepairStatus("partial", `Still missing: ${remainingMissing.join(", ")}`);
  } else if (updatedFields.length === 0 && diagnosis.missing.includes("wiki_source_url")) {
    statusUpdate = buildEnrichmentRepairStatus("wiki_not_found", "No Wikipedia article found");
  } else if (updatedFields.length > 0) {
    statusUpdate = buildEnrichmentRepairStatus("success");
  } else {
    statusUpdate = buildEnrichmentRepairStatus("success"); // Nothing to repair
  }

  // Signal repair-embeddings-pipeline to regenerate embeddings if enrichment data changed
  if (updates.vibes || updates.tone || updates.pacing || updates.themes || updates.profile_string) {
    updates.needs_enrichment = true;
  }

  // Apply updates (including embeddings)
  if (!dryRun && (allUpdatedFields.length > 0 || statusUpdate)) {
    await updateTitle(title.id, { ...updates, ...statusUpdate });
  }

  return {
    id: title.id,
    title: title.title,
    status: statusUpdate?.enrichment_repair_status || "success",
    updates: updatedFields,
    embeddingsRefreshed: !!embeddingsRefreshed,
    missing: diagnosis.missing,
    errors,
  };
}

/**
 * Run the enrichment repair pipeline
 */
async function run() {
  const options = parseArgs();

  initFileLogging("repair-enrichment");
  info("Starting enrichment repair pipeline", options);

  // Create rate limiters
  const wikiRateLimiter = createWikipediaRateLimiter();
  const openaiRateLimiter = createOpenAIRateLimiter(100);
  const wikipedia = createWikipediaFetcher(wikiRateLimiter);
  const rateLimiters = { wikiRateLimiter, openaiRateLimiter };

  // Find titles needing repair
  info("Finding titles needing enrichment repair...");
  const titles = options.sparseVibesOnly
    ? await findTitlesWithSparseVibes(options.limit)
    : await findTitlesNeedingEnrichmentRepair(options);
  info(`Found ${titles.length} titles needing enrichment repair${options.sparseVibesOnly ? " (sparse vibes)" : ""}`);

  if (titles.length === 0) {
    info("No titles need enrichment repair");
    closeFileLogging();
    return;
  }

  // Dry run mode
  if (options.dryRun) {
    info("=== DRY RUN ===");
    const sample = titles.slice(0, 20);
    for (const t of sample) {
      const diagnosis = diagnoseEnrichmentNeeds(t);
      info(`  ${t.title} (${t.id}): missing ${diagnosis.missing.join(", ")}`);
    }
    if (titles.length > 20) {
      info(`  ... and ${titles.length - 20} more`);
    }
    closeFileLogging();
    return;
  }

  // Progress tracking
  const progress = new ProgressTracker("repair-enrichment");

  if (options.resume && progress.loadCheckpoint()) {
    info("Resumed from checkpoint", progress.getSummary());
  }

  progress.setTotal(titles.length);

  // Stats by status
  const stats = {
    success: 0,
    partial: 0,
    wiki_not_found: 0,
    llm_error: 0,
    validation_failed: 0,
  };

  // Process titles
  for (const title of titles) {
    if (progress.isProcessed(title.id)) {
      progress.recordSkip(title.id);
      continue;
    }

    try {
      const result = await repairTitleEnrichment(
        title,
        rateLimiters,
        wikipedia,
        options.mode,
        false,
        options.skipEmbeddings
      );

      stats[result.status] = (stats[result.status] || 0) + 1;

      if (result.status === "success" && result.updates.length > 0) {
        info(`Repaired: ${title.title} -> ${result.updates.join(", ")}`);
        progress.recordSuccess(title.id);
      } else if (result.status === "partial") {
        warn(`Partial: ${title.title} - ${result.errors.join("; ")}`);
        progress.recordFailure(title.id);
      } else if (result.status === "wiki_not_found") {
        debug(`No wiki: ${title.title}`);
        progress.recordFailure(title.id);
      } else if (result.status === "llm_error") {
        error(`LLM error: ${title.title} - ${result.errors.join("; ")}`);
        progress.recordFailure(title.id);
      } else {
        progress.recordSuccess(title.id);
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
  info("=== Enrichment Repair Complete ===");
  info("Results:", stats);
  progress.printProgress();

  closeFileLogging();
}

// Run the pipeline
run().catch((err) => {
  error("Pipeline failed", { error: err.message });
  process.exit(1);
});
