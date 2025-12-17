/**
 * DEPRECATED: Use repair-tmdb-pipeline.js or repair-enrichment-pipeline.js instead.
 * This file will be removed in a future update.
 *
 * Repair Pipeline
 * Fixes titles with missing fields (overview, vibes, themes, slots, profile_string, embeddings)
 */

console.warn("\n⚠️  DEPRECATION WARNING: This pipeline is deprecated.");
console.warn("   Use 'node index.js repair-tmdb' for TMDB metadata repairs");
console.warn("   Use 'node index.js repair-enrichment' for enrichment repairs");
console.warn("   Use 'node index.js repair-status' to view repair queue status\n");

import "dotenv/config";
import { getSupabase, updateTitle } from "../lib/supabase.js";
import { createWikipediaRateLimiter, createOpenAIRateLimiter, createTMDBRateLimiter } from "../lib/rate-limiter.js";
import { ProgressTracker } from "../lib/progress.js";
import { initFileLogging, closeFileLogging, info, error, warn, debug } from "../lib/logger.js";
import { createWikipediaFetcher } from "../wikipedia/fetcher.js";
import { fetchWikipediaContent } from "../wikipedia/content-fetcher.js";
import { extractVibes, extractVibesFromOverview } from "../enrichment/vibe-extractor.js";
import { extractThemes, extractThemesFromOverview } from "../enrichment/theme-extractor.js";
import { generateProfile, generateProfileFromOverview } from "../enrichment/profile-generator.js";
import { extractSlots, extractSlotsFromOverview } from "../enrichment/slot-extractor.js";
import { generateEmbeddingsForTitle } from "../embeddings/generator.js";
import { createTMDBClient } from "../tmdb/client.js";
import { extractAllMetadata } from "../tmdb/extractors.js";

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
    fetchTmdb: false, // Fetch missing TMDB metadata (overview, etc)
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[++i], 10);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--retry-wiki") {
      options.retryWiki = true;
    } else if (arg === "--fetch-tmdb") {
      options.fetchTmdb = true;
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

// Columns needed for repair processing (includes embeddings for single-row fetch)
const REPAIR_SELECT_COLUMNS = `
  id, kind, title, overview, release_date, cast, director, genres, keywords, certification,
  vibes, themes, tone, pacing, profile_string, slots, wiki_source_url,
  vibe_embedding, content_embedding, metadata_embedding
`.replace(/\s+/g, "");

// Lightweight query to find titles needing repair - NO embeddings
const REPAIR_ID_COLUMNS = `id, title`;

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

    // First pass: get IDs of titles needing repair (lightweight query)
    const { data, error: err } = await supabase
      .from("titles")
      .select(REPAIR_ID_COLUMNS)
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
 * Fetch full title data for repair processing
 * @param {number} id
 * @returns {Promise<Object>}
 */
async function fetchFullTitle(id) {
  const supabase = getSupabase();
  const { data, error: err } = await supabase
    .from("titles")
    .select(REPAIR_SELECT_COLUMNS)
    .eq("id", id)
    .single();

  if (err) {
    throw new Error(`Failed to fetch title ${id}: ${err.message}`);
  }
  return data;
}

/**
 * Find titles missing TMDB metadata (overview)
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function findTitlesNeedingTmdb(limit) {
  const supabase = getSupabase();
  const allResults = [];
  let offset = 0;

  while (allResults.length < limit) {
    const batchSize = Math.min(SUPABASE_PAGE_SIZE, limit - allResults.length);

    const { data, error: err } = await supabase
      .from("titles")
      .select(REPAIR_ID_COLUMNS)
      .is("overview", null)
      .order("vote_count", { ascending: false, nullsFirst: false })
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

    // Lightweight query - no embeddings
    const { data, error: err } = await supabase
      .from("titles")
      .select(REPAIR_ID_COLUMNS)
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
    needsOverview: !title.overview,
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
 * @param {Object|null} tmdb - TMDB client (null to skip TMDB fetch)
 * @param {boolean} dryRun
 * @returns {Promise<Object>}
 */
async function repairTitle(title, rateLimiters, tmdb, dryRun) {
  const { wikiRateLimiter, openaiRateLimiter } = rateLimiters;
  const needs = analyzeRepairNeeds(title);
  const updates = {};
  let contentFetched = false;
  let content = null;
  let tmdbFetched = false;

  // Step 0: Fetch TMDB metadata if overview is missing
  if (needs.needsOverview && tmdb) {
    try {
      const tmdbData = await tmdb.getDetails(title.id, title.kind);
      if (tmdbData) {
        const extracted = extractAllMetadata(tmdbData, title.kind);
        if (extracted.overview) {
          updates.overview = extracted.overview;
          title.overview = extracted.overview; // Update local copy for LLM steps
          tmdbFetched = true;
        }
        // Also fill in other missing TMDB fields
        if (!title.tagline && extracted.tagline) updates.tagline = extracted.tagline;
        if (!title.keywords?.length && extracted.keywords?.length) updates.keywords = extracted.keywords;
        if (!title.certification && extracted.certification) updates.certification = extracted.certification;
        if (!title.runtime_minutes && extracted.runtime_minutes) updates.runtime_minutes = extracted.runtime_minutes;
        if (!title.director && extracted.director) updates.director = extracted.director;
        if (!title.creators?.length && extracted.creators?.length) updates.creators = extracted.creators;
      }
    } catch (err) {
      debug(`Failed to fetch TMDB for ${title.id}: ${err.message}`);
    }
  }

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
    tmdbFetched,
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

  // Create TMDB client if needed
  let tmdb = null;
  if (options.fetchTmdb) {
    const tmdbRateLimiter = createTMDBRateLimiter();
    tmdb = createTMDBClient(tmdbRateLimiter);
  }

  const rateLimiters = { wikiRateLimiter, openaiRateLimiter };

  if (options.fetchTmdb) {
    // Mode: Fetch missing TMDB metadata (overview, etc)
    info("Mode: Fetch missing TMDB metadata");

    const titles = await findTitlesNeedingTmdb(options.limit);
    info(`Found ${titles.length} titles missing overview`);

    if (options.dryRun) {
      info("DRY RUN - Would fetch TMDB for these titles:");
      titles.slice(0, 20).forEach((t) => info(`  - ${t.title} (${t.id})`));
      if (titles.length > 20) info(`  ... and ${titles.length - 20} more`);
    } else {
      const progress = new ProgressTracker("repair-tmdb");
      progress.setTotal(titles.length);

      for (const titleStub of titles) {
        try {
          const title = await fetchFullTitle(titleStub.id);
          const result = await repairTitle(title, rateLimiters, tmdb, false);
          if (result.tmdbFetched) {
            info(`Fetched TMDB for: ${title.title} -> ${result.updates.join(", ")}`);
            progress.recordSuccess(title.id);
          } else {
            debug(`No TMDB data found for: ${title.title}`);
            progress.recordFailure(title.id);
          }

          if (progress.processed % 100 === 0) {
            progress.printProgress();
          }
        } catch (err) {
          error(`Error fetching TMDB for ${titleStub.title}`, { error: err.message });
          progress.recordFailure(titleStub.id);
        }
      }

      progress.saveCheckpoint();
      info("TMDB fetch completed", progress.getSummary());
      progress.printProgress();
    }
  } else if (options.retryWiki) {
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

      for (const titleStub of titles) {
        try {
          // Fetch full title data for wiki retry
          const title = await fetchFullTitle(titleStub.id);
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
          error(`Error retrying Wikipedia for ${titleStub.title}`, { error: err.message });
          progress.recordFailure(titleStub.id);
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
      info(`=== DRY RUN: ${titles.length} titles need repair ===`);
      titles.slice(0, 20).forEach((t) => info(`  - ${t.title} (${t.id})`));
      if (titles.length > 20) info(`  ... and ${titles.length - 20} more`);
    } else {
      const progress = new ProgressTracker("repair");
      progress.setTotal(titles.length);

      for (const titleStub of titles) {
        try {
          // Fetch full title data for repair
          const title = await fetchFullTitle(titleStub.id);
          const result = await repairTitle(title, rateLimiters, null, false);
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
          error(`Error repairing ${titleStub.title}`, { error: err.message });
          progress.recordFailure(titleStub.id);
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
