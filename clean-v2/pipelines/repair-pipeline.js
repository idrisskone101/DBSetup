/**
 * Repair Pipeline
 * Fixes enriched titles with missing fields (vibes, themes, slots, profile_string, embeddings)
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

const SUPABASE_PAGE_SIZE = 1000;

/**
 * Parse command line arguments
 * @returns {Object}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: 1000,
    dryRun: false,
    retryWiki: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--retry-wiki") {
      options.retryWiki = true;
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
 * Find enriched titles that need repair
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function findTitlesNeedingRepair(limit) {
  const supabase = getSupabase();
  const allResults = [];
  let offset = 0;

  while (allResults.length < limit) {
    const batchSize = Math.min(SUPABASE_PAGE_SIZE, limit - allResults.length);

    const { data, error: err } = await supabase
      .from("titles")
      .select("*")
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

    if (err) {
      throw new Error(`Failed to fetch titles: ${err.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    allResults.push(...data);
    offset += data.length;

    if (data.length < batchSize) {
      break;
    }
  }

  return allResults;
}

/**
 * Find titles needing Wikipedia retry (no wiki_source_url)
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function findTitlesNeedingWikiRetry(limit) {
  const supabase = getSupabase();
  const allResults = [];
  let offset = 0;

  while (allResults.length < limit) {
    const batchSize = Math.min(SUPABASE_PAGE_SIZE, limit - allResults.length);

    const { data, error: err } = await supabase
      .from("titles")
      .select("*")
      .eq("enrichment_status", "enriched")
      .is("wiki_source_url", null)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (err) {
      throw new Error(`Failed to fetch titles: ${err.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    allResults.push(...data);
    offset += data.length;

    if (data.length < batchSize) {
      break;
    }
  }

  return allResults;
}

/**
 * Analyze what needs to be repaired for a title
 * @param {Object} title
 * @returns {Object}
 */
function analyzeRepairNeeds(title) {
  return {
    needsVibes: !title.vibes,
    needsTone: !title.tone,
    needsPacing: !title.pacing,
    needsThemes: !title.themes,
    needsProfile: !title.profile_string,
    needsSlots: !title.slots,
    needsVibeEmbedding: !title.vibe_embedding,
    needsContentEmbedding: !title.content_embedding,
    needsMetadataEmbedding: !title.metadata_embedding,
    hasWikiUrl: !!title.wiki_source_url,
  };
}

/**
 * Repair a single title
 * @param {Object} title
 * @param {Object} rateLimiters
 * @param {boolean} dryRun
 * @returns {Promise<Object>}
 */
async function repairTitle(title, rateLimiters, dryRun) {
  const { wikiRateLimiter, openaiRateLimiter } = rateLimiters;
  const needs = analyzeRepairNeeds(title);
  const updates = {};
  let contentFetched = false;
  let content = null;

  // Step 1: Get content source if needed
  const needsLlm = needs.needsVibes || needs.needsThemes || needs.needsProfile || needs.needsSlots;
  if (needsLlm && title.wiki_source_url) {
    content = await fetchWikipediaContent(title.wiki_source_url, wikiRateLimiter);
    contentFetched = true;
  }

  // Step 2: Repair missing vibes/tone/pacing
  if (needs.needsVibes || needs.needsTone || needs.needsPacing) {
    await openaiRateLimiter.acquire();
    const vibeData = content
      ? await extractVibes(content, title.title, title.kind)
      : await extractVibesFromOverview(title.overview, title.title, title.kind, title.genres);

    if (needs.needsVibes && Object.keys(vibeData.vibes).length > 0) {
      updates.vibes = vibeData.vibes;
    }
    if (needs.needsTone && vibeData.tone) {
      updates.tone = vibeData.tone;
    }
    if (needs.needsPacing && vibeData.pacing) {
      updates.pacing = vibeData.pacing;
    }
  }

  // Step 3: Repair missing themes
  if (needs.needsThemes) {
    await openaiRateLimiter.acquire();
    const themes = content
      ? await extractThemes(content, title.title)
      : await extractThemesFromOverview(title.overview, title.title, title.genres);

    if (themes && themes.length > 0) {
      updates.themes = themes;
    }
  }

  // Step 4: Repair missing profile_string
  if (needs.needsProfile) {
    await openaiRateLimiter.acquire();
    const profile = content
      ? await generateProfile(content, title.title, title.overview)
      : await generateProfileFromOverview(title.overview, title.title, title.genres);

    if (profile) {
      updates.profile_string = profile;
    }
  }

  // Step 5: Repair missing slots
  if (needs.needsSlots) {
    await openaiRateLimiter.acquire();
    const slots = content
      ? await extractSlots(content, title.title, title.kind)
      : await extractSlotsFromOverview(title.overview, title.title, title.genres);

    if (slots) {
      updates.slots = slots;
    }
  }

  // Step 6: Regenerate embeddings if any fields changed or missing
  const needsEmbeddings = needs.needsVibeEmbedding || needs.needsContentEmbedding || needs.needsMetadataEmbedding;
  if (Object.keys(updates).length > 0 || needsEmbeddings) {
    const merged = { ...title, ...updates };
    const embeddings = await generateEmbeddingsForTitle(merged);

    if (needs.needsVibeEmbedding && embeddings.vibe) {
      updates.vibe_embedding = embeddings.vibe;
    }
    if (needs.needsContentEmbedding && embeddings.content) {
      updates.content_embedding = embeddings.content;
    }
    if (needs.needsMetadataEmbedding && embeddings.metadata) {
      updates.metadata_embedding = embeddings.metadata;
    }
  }

  // Step 7: Update database
  if (Object.keys(updates).length > 0 && !dryRun) {
    await updateTitle(title.id, updates);
  }

  return {
    id: title.id,
    title: title.title,
    needs,
    updates: Object.keys(updates),
    contentFetched,
    success: Object.keys(updates).length > 0,
  };
}

/**
 * Retry Wikipedia search for a title
 * @param {Object} title
 * @param {Object} wikipedia - WikipediaFetcher instance
 * @param {Object} openaiRateLimiter
 * @param {boolean} dryRun
 * @returns {Promise<Object>}
 */
async function retryWikipediaForTitle(title, wikipedia, openaiRateLimiter, dryRun) {
  const year = getYear(title.release_date);
  const updates = {};

  // Use repair patterns (more aggressive)
  const patterns = wikipedia.generateRepairTitlePatterns(title.title, year, title.kind, {
    director: title.director,
    cast: title.cast,
  });

  debug(`Trying ${patterns.length} patterns for: ${title.title}`);

  // Try to find Wikipedia article
  const wikiResult = await wikipedia.fetchForTitle(title.title, year, title.kind, {
    director: title.director,
    cast: title.cast,
  });

  if (!wikiResult) {
    return {
      id: title.id,
      title: title.title,
      success: false,
      reason: "No Wikipedia article found",
    };
  }

  const content = wikiResult.content;
  updates.wiki_source_url = wikiResult.url;

  // Now extract all fields using Wikipedia content
  await openaiRateLimiter.acquire();
  const vibeData = await extractVibes(content, title.title, title.kind);
  if (Object.keys(vibeData.vibes).length > 0) updates.vibes = vibeData.vibes;
  if (vibeData.tone) updates.tone = vibeData.tone;
  if (vibeData.pacing) updates.pacing = vibeData.pacing;

  await openaiRateLimiter.acquire();
  const themes = await extractThemes(content, title.title);
  if (themes && themes.length > 0) updates.themes = themes;

  await openaiRateLimiter.acquire();
  const profile = await generateProfile(content, title.title, title.overview);
  if (profile) updates.profile_string = profile;

  await openaiRateLimiter.acquire();
  const slots = await extractSlots(content, title.title, title.kind);
  if (slots) updates.slots = slots;

  // Regenerate embeddings
  const merged = { ...title, ...updates };
  const embeddings = await generateEmbeddingsForTitle(merged);
  if (embeddings.vibe) updates.vibe_embedding = embeddings.vibe;
  if (embeddings.content) updates.content_embedding = embeddings.content;
  if (embeddings.metadata) updates.metadata_embedding = embeddings.metadata;

  // Update database
  if (!dryRun) {
    await updateTitle(title.id, updates);
  }

  return {
    id: title.id,
    title: title.title,
    success: true,
    wikiUrl: wikiResult.url,
    updates: Object.keys(updates),
  };
}

/**
 * Print dry run report
 * @param {Array} titles
 */
function printDryRunReport(titles) {
  const counts = {
    vibes: 0,
    themes: 0,
    tone: 0,
    pacing: 0,
    profile_string: 0,
    slots: 0,
    vibe_embedding: 0,
    content_embedding: 0,
    metadata_embedding: 0,
    withWikiUrl: 0,
    withoutWikiUrl: 0,
  };

  for (const title of titles) {
    const needs = analyzeRepairNeeds(title);
    if (needs.needsVibes) counts.vibes++;
    if (needs.needsThemes) counts.themes++;
    if (needs.needsTone) counts.tone++;
    if (needs.needsPacing) counts.pacing++;
    if (needs.needsProfile) counts.profile_string++;
    if (needs.needsSlots) counts.slots++;
    if (needs.needsVibeEmbedding) counts.vibe_embedding++;
    if (needs.needsContentEmbedding) counts.content_embedding++;
    if (needs.needsMetadataEmbedding) counts.metadata_embedding++;
    if (needs.hasWikiUrl) counts.withWikiUrl++;
    else counts.withoutWikiUrl++;
  }

  info("=== DRY RUN REPORT ===");
  info(`Total titles needing repair: ${titles.length}`);
  info("");
  info("Missing fields:");
  info(`  slots: ${counts.slots}`);
  info(`  profile_string: ${counts.profile_string}`);
  info(`  themes: ${counts.themes}`);
  info(`  vibes: ${counts.vibes}`);
  info(`  tone: ${counts.tone}`);
  info(`  pacing: ${counts.pacing}`);
  info(`  vibe_embedding: ${counts.vibe_embedding}`);
  info(`  content_embedding: ${counts.content_embedding}`);
  info(`  metadata_embedding: ${counts.metadata_embedding}`);
  info("");
  info("Wikipedia status:");
  info(`  With wiki_source_url: ${counts.withWikiUrl}`);
  info(`  Without wiki_source_url: ${counts.withoutWikiUrl}`);
}

/**
 * Run the repair pipeline
 */
async function run() {
  const options = parseArgs();

  initFileLogging("repair");
  info("Starting repair pipeline", options);

  // Create rate limiters
  const wikiRateLimiter = createWikipediaRateLimiter();
  const openaiRateLimiter = createOpenAIRateLimiter(100); // 100ms between OpenAI calls
  const wikipedia = createWikipediaFetcher(wikiRateLimiter);

  const rateLimiters = { wikiRateLimiter, openaiRateLimiter };

  if (options.retryWiki) {
    // Mode: Retry Wikipedia for titles without wiki_source_url
    info("Mode: Retry Wikipedia search");

    const titles = await findTitlesNeedingWikiRetry(options.limit);
    info(`Found ${titles.length} titles without wiki_source_url`);

    if (options.dryRun) {
      info("DRY RUN - Would retry Wikipedia for these titles:");
      titles.slice(0, 20).forEach((t) => info(`  - ${t.title} (${t.id})`));
      if (titles.length > 20) info(`  ... and ${titles.length - 20} more`);
    } else {
      const progress = new ProgressTracker("repair-wiki");
      progress.setTotal(titles.length);

      for (const title of titles) {
        try {
          const result = await retryWikipediaForTitle(title, wikipedia, openaiRateLimiter, false);
          if (result.success) {
            info(`Found Wikipedia for: ${title.title} -> ${result.wikiUrl}`);
            progress.recordSuccess(title.id);
          } else {
            debug(`No Wikipedia found for: ${title.title}`);
            progress.recordFailure(title.id);
          }

          if (progress.processed % 20 === 0) {
            progress.printProgress();
          }
        } catch (err) {
          error(`Error retrying Wikipedia for ${title.title}`, { error: err.message });
          progress.recordFailure(title.id);
        }
      }

      info("Wikipedia retry completed", progress.getSummary());
    }
  } else {
    // Mode: Repair missing fields
    info("Mode: Repair missing fields");

    const titles = await findTitlesNeedingRepair(options.limit);
    info(`Found ${titles.length} titles needing repair`);

    if (options.dryRun) {
      printDryRunReport(titles);
    } else {
      const progress = new ProgressTracker("repair");
      progress.setTotal(titles.length);

      for (const title of titles) {
        try {
          const result = await repairTitle(title, rateLimiters, false);
          if (result.success) {
            info(`Repaired: ${title.title} -> ${result.updates.join(", ")}`);
            progress.recordSuccess(title.id);
          } else {
            debug(`No updates for: ${title.title}`);
            progress.recordFailure(title.id);
          }

          if (progress.processed % 50 === 0) {
            progress.printProgress();
          }
        } catch (err) {
          error(`Error repairing ${title.title}`, { error: err.message });
          progress.recordFailure(title.id);
        }
      }

      progress.saveCheckpoint();
      info("Repair completed", progress.getSummary());
      progress.printProgress();
    }
  }

  closeFileLogging();
}

// Run the pipeline
run().catch((err) => {
  error("Pipeline failed", { error: err.message });
  process.exit(1);
});
