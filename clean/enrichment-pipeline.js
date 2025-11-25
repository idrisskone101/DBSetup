/**
 * Unified Enrichment Pipeline - Scaled Version
 * 
 * Orchestrates the full enrichment + embedding workflow for titles:
 * 1. Fetch titles from database (with checkpoint resume support)
 * 2. Enrich with TMDB metadata (writes to DB immediately)
 * 3. Enrich with Wikipedia metadata (writes to DB immediately)
 * 4. Generate embeddings in batches (vibe, content, metadata)
 * 5. Write embeddings directly to database
 * 
 * Usage:
 *   node clean/enrichment-pipeline.js              # Fresh run (up to 6000 titles)
 *   node clean/enrichment-pipeline.js --resume     # Continue from checkpoint
 *   node clean/enrichment-pipeline.js --limit 100  # Process only 100 titles
 *   node clean/enrichment-pipeline.js --clear      # Clear checkpoint and start fresh
 *   node clean/enrichment-pipeline.js --skip-enriched  # Skip already enriched titles (uses DB status)
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import dotenv from "dotenv";

// TMDB imports
import { getMovieDetails, getTvDetails, sleep, checkConnection } from "./tmdb/client.js";
import { extractAllMetadata } from "./tmdb/extractors.js";
import { normalizeGenre } from "./genre-standardizer.js";

// Wikipedia imports
import { getWikiContent } from "./wikipedia-enrich/wikipedia-fetcher.js";
import { extractStandardizedMetadata, createEmptyMetadata } from "./wikipedia-enrich/llm-extractor.js";

// Local lib utilities
import { CONFIG } from "./lib/config.js";
import { RateLimiter, delay, categorizeError } from "./lib/rate-limiter.js";
import { ProgressTracker } from "./lib/progress-tracker.js";
import { FailureLogger } from "./lib/failure-logger.js";

dotenv.config();

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const args = process.argv.slice(2);
const RESUME_MODE = args.includes("--resume");
const CLEAR_MODE = args.includes("--clear");
const SKIP_ENRICHED = args.includes("--skip-enriched");
const limitArgIndex = args.indexOf("--limit");
const PIPELINE_LIMIT = limitArgIndex >= 0 && args[limitArgIndex + 1]
  ? parseInt(args[limitArgIndex + 1], 10)
  : CONFIG.pipeline.limit;

// ============================================================================
// Environment & Clients Setup
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000,
  maxRetries: 2,
});

// ============================================================================
// Rate Limiters
// ============================================================================

const tmdbRateLimiter = new RateLimiter({
  delayMs: CONFIG.rateLimits.tmdb.delayMs,
  maxRetries: CONFIG.rateLimits.tmdb.maxRetries,
  backoffMultiplier: CONFIG.rateLimits.tmdb.backoffMultiplier,
  name: "tmdb",
});

const wikiRateLimiter = new RateLimiter({
  delayMs: CONFIG.rateLimits.wikipedia.delayMs,
  maxRetries: CONFIG.rateLimits.wikipedia.maxRetries,
  backoffMultiplier: CONFIG.rateLimits.wikipedia.backoffMultiplier,
  name: "wikipedia",
});

// ============================================================================
// Embedding Text Generation Functions
// ============================================================================

/**
 * Generate VIBE embedding text from title data
 * Uses scored vibes in format: "vibe: score, vibe: score"
 * Only includes vibes with score >= 0.3, sorted by score descending
 * 
 * @param {Object} title - Title object with vibes, tone, pacing, tagline
 * @returns {string} - Formatted text for vibe embedding
 */
function generateVibeEmbeddingText(title) {
  const parts = [];

  // Handle vibes - can be object with scores or array
  if (title.vibes) {
    if (typeof title.vibes === "object" && !Array.isArray(title.vibes)) {
      // Scored vibes object: { dark: 0.90, cozy: 0.75, ... }
      const scoredVibes = Object.entries(title.vibes)
        .filter(([_, score]) => score >= 0.3)
        .sort((a, b) => b[1] - a[1])
        .map(([vibe, score]) => `${vibe}: ${score.toFixed(2)}`)
        .join(", ");
      
      if (scoredVibes) {
        parts.push(`Vibes: ${scoredVibes}`);
      }
    } else if (Array.isArray(title.vibes) && title.vibes.length > 0) {
      // Array of vibe names (legacy format)
      parts.push(`Vibes: ${title.vibes.join(", ")}`);
    }
  }

  // Tone descriptor
  if (title.tone) {
    parts.push(`Tone: ${title.tone}`);
  }

  // Pacing descriptor
  if (title.pacing) {
    parts.push(`Pacing: ${title.pacing}`);
  }

  // Tagline (marketing emotional hook)
  if (title.tagline) {
    parts.push(`Tagline: ${title.tagline}`);
  }

  // Fallback
  if (parts.length === 0) {
    return `${title.title || "Unknown"} - No vibe data available`;
  }

  return parts.join(". ");
}

/**
 * Generate CONTENT embedding text from title data
 * Focuses on story/narrative elements
 * 
 * @param {Object} title - Title object
 * @returns {string} - Formatted text for content embedding
 */
function generateContentEmbeddingText(title) {
  const parts = [];

  // Profile string (spoiler-safe logline)
  if (title.profile_string) {
    parts.push(`Story: ${title.profile_string}`);
  }

  // Themes
  if (title.themes && title.themes.length > 0) {
    parts.push(`Themes: ${title.themes.join(", ")}`);
  }

  // Overview
  if (title.overview && title.overview !== title.profile_string) {
    parts.push(`Overview: ${title.overview}`);
  }

  // Story slots
  if (title.slots) {
    if (title.slots.protagonist) parts.push(`Protagonist: ${title.slots.protagonist}`);
    if (title.slots.setting_place) parts.push(`Setting: ${title.slots.setting_place}`);
    if (title.slots.setting_time) parts.push(`Time Period: ${title.slots.setting_time}`);
    if (title.slots.goal) parts.push(`Goal: ${title.slots.goal}`);
    if (title.slots.obstacle) parts.push(`Obstacle: ${title.slots.obstacle}`);
    if (title.slots.stakes) parts.push(`Stakes: ${title.slots.stakes}`);
  }

  // Keywords (TMDB)
  if (title.keywords && title.keywords.length > 0) {
    parts.push(`Keywords: ${title.keywords.slice(0, 15).join(", ")}`);
  }

  // Fallback
  if (parts.length === 0) {
    return `${title.title || "Unknown"} - No story data available`;
  }

  return parts.join(". ");
}

/**
 * Generate METADATA embedding text from title data
 * Focuses on factual/categorical data
 * 
 * @param {Object} title - Title object
 * @returns {string} - Formatted text for metadata embedding
 */
function generateMetadataEmbeddingText(title) {
  const parts = [];

  // Type
  parts.push(`Type: ${title.kind || "unknown"}`);

  // Genres
  if (title.genres && title.genres.length > 0) {
    parts.push(`Genres: ${title.genres.join(", ")}`);
  }

  // Director or Creators
  if (title.director) {
    parts.push(`Director: ${title.director}`);
  } else if (title.creators && title.creators.length > 0) {
    parts.push(`Creators: ${title.creators.join(", ")}`);
  }

  // Writers
  if (title.writers && title.writers.length > 0) {
    parts.push(`Writers: ${title.writers.slice(0, 3).join(", ")}`);
  }

  // Certification
  if (title.certification) {
    parts.push(`Rating: ${title.certification}`);
  }

  // Production countries
  if (title.production_countries && title.production_countries.length > 0) {
    parts.push(`Countries: ${title.production_countries.join(", ")}`);
  }

  // Collection
  if (title.collection_name) {
    parts.push(`Collection: ${title.collection_name}`);
  }

  // Release year
  if (title.release_date) {
    const year = title.release_date.split("-")[0];
    parts.push(`Released: ${year}`);
  }

  // Runtime
  if (title.runtime_minutes) {
    parts.push(`Runtime: ${title.runtime_minutes} minutes`);
  }

  return parts.join(". ");
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embeddings for a batch of texts (chunked for safety)
 * @param {string[]} texts - Array of text strings to embed
 * @param {string} label - Label for progress logging
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
async function generateEmbeddingsChunked(texts, label = "embeddings") {
  if (!texts || texts.length === 0) return [];

  const batchSize = CONFIG.rateLimits.openai.embeddingBatchSize;
  const results = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize);
    
    try {
      const response = await openai.embeddings.create({
        model: CONFIG.embeddings.model,
        input: chunk,
        encoding_format: "float",
      });

      const embeddings = response.data.map((item) => item.embedding);
      results.push(...embeddings);

      const progress = Math.min(i + batchSize, texts.length);
      process.stdout.write(`\r  📊 ${label}: ${progress}/${texts.length}`);

      // Delay between batches to avoid rate limits
      if (i + batchSize < texts.length) {
        await delay(CONFIG.rateLimits.openai.delayBetweenBatches);
      }
    } catch (error) {
      console.error(`\n❌ Error generating embeddings at batch ${i}: ${error.message}`);
      // Fill with nulls for failed batch
      results.push(...chunk.map(() => null));
    }
  }

  console.log(""); // New line after progress
  return results;
}

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Fetch titles for enrichment (top by popularity, excluding already processed)
 * @param {number[]} excludeIds - IDs to exclude (already processed)
 * @returns {Promise<Object[]>} - Array of title objects
 */
async function getTitlesForEnrichment(excludeIds = []) {
  console.log(`📊 Fetching up to ${PIPELINE_LIMIT} titles by popularity...`);
  
  if (SKIP_ENRICHED) {
    console.log(`   Filtering for titles with enrichment_status IS NULL`);
  }

  let query = supabase
    .from("titles")
    .select(`
      id, kind, title, release_date, overview, runtime_minutes,
      genres, profile_string, slots, keywords,
      cast, director, writers, creators, certification,
      production_countries, collection_name, tagline, providers,
      vibes, themes, tone, pacing
    `)
    .order("popularity", { ascending: false, nullsFirst: false })
    .limit(PIPELINE_LIMIT);

  // Filter by enrichment_status if --skip-enriched flag is set
  if (SKIP_ENRICHED) {
    query = query.is("enrichment_status", null);
  }

  // Exclude already processed IDs if resuming
  if (excludeIds.length > 0) {
    // Supabase doesn't have a simple "not in" for large arrays, so we'll filter client-side
    // For large datasets, consider a different approach
    console.log(`   Excluding ${excludeIds.length} already processed titles`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch titles: ${error.message}`);
  }

  // Filter out already processed IDs
  let titles = data || [];
  if (excludeIds.length > 0) {
    const excludeSet = new Set(excludeIds);
    titles = titles.filter((t) => !excludeSet.has(t.id));
  }

  return titles;
}

/**
 * Update TMDB metadata for a title
 */
async function updateTmdbMetadata(titleId, metadata) {
  const updateData = {
    cast: metadata.cast || null,
    director: metadata.director || null,
    writers: metadata.writers || [],
    creators: metadata.creators || [],
    keywords: metadata.keywords || [],
    genres: metadata.genres || [],
    certification: metadata.certification || null,
    production_countries: metadata.production_countries || [],
    collection_id: metadata.collection_id || null,
    collection_name: metadata.collection_name || null,
    tagline: metadata.tagline || null,
    providers: metadata.providers || null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("titles")
    .update(updateData)
    .eq("id", titleId);

  return error ? { success: false, error: error.message } : { success: true };
}

/**
 * Update Wikipedia metadata for a title
 * Stores vibes as JSONB object with scores (not converted to array)
 */
async function updateWikipediaMetadata(titleId, metadata, wikiUrl = null) {
  const updateData = {
    vibes: metadata.vibes || null, // Store as JSONB object with scores
    themes: metadata.themes || [],
    tone: metadata.tone || null,
    pacing: metadata.pacing || null,
    wiki_source_url: wikiUrl,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("titles")
    .update(updateData)
    .eq("id", titleId);

  return error ? { success: false, error: error.message } : { success: true };
}

/**
 * Update embeddings for a batch of titles and mark as enriched
 * @param {Object[]} titlesWithEmbeddings - Array of { id, embeddings: { vibe, content, metadata } }
 * @returns {Promise<{success: number, failed: number}>}
 */
async function updateEmbeddingsBatch(titlesWithEmbeddings) {
  const batchSize = CONFIG.database.upsertBatchSize;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < titlesWithEmbeddings.length; i += batchSize) {
    const batch = titlesWithEmbeddings.slice(i, i + batchSize);
    
    // Use Promise.all for parallel updates within batch
    const results = await Promise.all(
      batch.map(async (item) => {
        const { error } = await supabase
          .from("titles")
          .update({
            vibe_embedding: item.embeddings.vibe,
            content_embedding: item.embeddings.content,
            metadata_embedding: item.embeddings.metadata,
            enrichment_status: "enriched",
            enriched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);

        return error ? false : true;
      })
    );

    success += results.filter(Boolean).length;
    failed += results.filter((r) => !r).length;

    const progress = Math.min(i + batchSize, titlesWithEmbeddings.length);
    process.stdout.write(`\r  💾 Writing embeddings: ${progress}/${titlesWithEmbeddings.length}`);
  }

  console.log(""); // New line after progress
  return { success, failed };
}

/**
 * Mark a title as failed enrichment
 * @param {number} titleId - The title ID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function markEnrichmentFailed(titleId) {
  const { error } = await supabase
    .from("titles")
    .update({
      enrichment_status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", titleId);

  return error ? { success: false, error: error.message } : { success: true };
}

// ============================================================================
// Enrichment Functions
// ============================================================================

/**
 * Enrich title with TMDB data
 */
async function enrichWithTmdb(title) {
  try {
    await tmdbRateLimiter.acquire();
    
    const detail = title.kind === "movie"
      ? await getMovieDetails(title.id)
      : await getTvDetails(title.id);

    const metadata = extractAllMetadata(detail, title.kind);

    // Standardize genres
    if (metadata.genres && metadata.genres.length > 0) {
      const standardizedGenres = new Set();
      for (const genre of metadata.genres) {
        const normalized = normalizeGenre(genre);
        normalized.forEach((g) => standardizedGenres.add(g));
      }
      metadata.genres = [...standardizedGenres];
    }

    tmdbRateLimiter.reportSuccess();
    return { success: true, metadata };
  } catch (error) {
    if (error.response?.status === 429) {
      tmdbRateLimiter.reportRateLimit();
    } else {
      tmdbRateLimiter.reportError();
    }
    
    if (error.response?.status === 404) {
      return { success: false, error: "Not found in TMDB", errorType: "not_found" };
    }
    return { success: false, error: error.message, errorType: categorizeError(error) };
  }
}

/**
 * Enrich title with Wikipedia data
 * Falls back to TMDB overview/profile_string if Wikipedia content not found
 */
async function enrichWithWikipedia(title) {
  try {
    const year = title.release_date ? title.release_date.slice(0, 4) : undefined;
    
    const { summary, plot, foundTitle, url: wikiUrl } = await getWikiContent(title.title, {
      year,
      kind: title.kind,
      rateLimiter: wikiRateLimiter,
    });

    const wikiText = [summary, plot].filter(Boolean).join("\n\n");

    // If Wikipedia content found, use it
    if (wikiText) {
      const metadata = await extractStandardizedMetadata(wikiText, {
        title: title.title,
        year,
        kind: title.kind,
        genres: title.genres,
      });

      return { success: true, metadata, foundTitle, wikiUrl };
    }

    // Fallback: Use TMDB overview and profile_string to infer vibes/themes/tone/pacing
    const tmdbText = [title.overview, title.profile_string].filter(Boolean).join("\n\n");
    
    if (tmdbText) {
      const metadata = await extractStandardizedMetadata(tmdbText, {
        title: title.title,
        year,
        kind: title.kind,
        genres: title.genres,
      });

      return { 
        success: true, 
        metadata, 
        foundTitle: null, 
        wikiUrl: null,
        source: "tmdb_fallback" 
      };
    }

    // No content available from either source
    return { success: false, error: "No Wikipedia or TMDB content found", metadata: createEmptyMetadata() };
  } catch (error) {
    return { success: false, error: error.message, metadata: createEmptyMetadata(), errorType: categorizeError(error) };
  }
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function runPipeline() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚀 UNIFIED ENRICHMENT PIPELINE (Scaled)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const modeStr = RESUME_MODE ? "RESUME from checkpoint" : CLEAR_MODE ? "FRESH START (cleared)" : "Normal";
  console.log(`📋 Mode: ${modeStr}${SKIP_ENRICHED ? " + SKIP ENRICHED" : ""}`);
  console.log(`📋 Limit: ${PIPELINE_LIMIT} titles`);
  console.log("Stages: TMDB → Wikipedia → Embeddings → DB Write\n");

  // Initialize progress tracker and failure logger
  const progress = new ProgressTracker("enrichment-pipeline", PIPELINE_LIMIT);
  const failures = new FailureLogger("enrichment-pipeline");

  // Handle clear mode
  if (CLEAR_MODE) {
    progress.clear();
    console.log("✓ Checkpoint cleared\n");
  }

  // Check for existing progress
  if (RESUME_MODE && progress.hasExistingProgress()) {
    console.log(`📂 Resuming from checkpoint: ${progress.getProcessedIds().length} titles already processed`);
  } else if (!RESUME_MODE && progress.hasExistingProgress()) {
    console.log("⚠️  Existing progress found. Use --resume to continue or --clear to start fresh.");
    console.log(`   Already processed: ${progress.getProcessedIds().length} titles`);
    console.log("");
  }

  // Check TMDB connection
  console.log("🔌 Checking TMDB API connection...");
  const tmdbConnected = await checkConnection();
  if (!tmdbConnected) {
    console.error("❌ Cannot connect to TMDB API. Check your TMDB_TOKEN.");
    process.exit(1);
  }
  console.log("✓ TMDB API connected\n");

  // Get already processed IDs if resuming
  const processedIds = RESUME_MODE ? progress.getProcessedIds() : [];

  // Fetch titles
  const titles = await getTitlesForEnrichment(processedIds);

  if (titles.length === 0) {
    console.log("⚠️  No titles to process.");
    if (processedIds.length > 0) {
      console.log("   All titles have been processed. Use --clear to start fresh.");
    }
    return;
  }

  console.log(`📋 Found ${titles.length} titles to process\n`);

  // Update progress tracker with actual count
  progress.update({ totalItems: titles.length + processedIds.length });

  const enrichedTitles = []; // Store titles for embedding generation
  const startTime = Date.now();

  // ============================================================================
  // Stage 1 & 2: TMDB + Wikipedia Enrichment (with checkpointing)
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 STAGE 1 & 2: TMDB + Wikipedia Enrichment");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const globalIndex = processedIds.length + i + 1;
    
    console.log(`[${globalIndex}/${titles.length + processedIds.length}] ${title.title} (ID: ${title.id}, ${title.kind})`);

    const enrichedData = {
      id: title.id,
      kind: title.kind,
      title: title.title,
      vibesScored: null,
    };

    // Copy existing data
    Object.assign(enrichedData, title);

    // TMDB Enrichment
    console.log("  🎬 Fetching TMDB data...");
    const tmdbResult = await enrichWithTmdb(title);
    
    if (tmdbResult.success) {
      const dbResult = await updateTmdbMetadata(title.id, tmdbResult.metadata);
      if (dbResult.success) {
        progress.incrementStat("tmdb", "success");
        Object.assign(enrichedData, tmdbResult.metadata);
        console.log("  ✓ TMDB enriched & saved");
      } else {
        progress.incrementStat("tmdb", "failed");
        failures.logFailure(title.id, title.title, "tmdb_db", dbResult.error);
        console.log(`  ✗ TMDB DB update failed: ${dbResult.error}`);
      }
    } else {
      progress.incrementStat("tmdb", "failed");
      if (tmdbResult.errorType !== "not_found") {
        failures.logFailure(title.id, title.title, "tmdb", tmdbResult.error);
      }
      console.log(`  ✗ TMDB failed: ${tmdbResult.error}`);
    }

    // Wikipedia Enrichment (with TMDB fallback)
    console.log("  📚 Fetching Wikipedia data...");
    const wikiResult = await enrichWithWikipedia(title);
    
    if (wikiResult.success) {
      const dbResult = await updateWikipediaMetadata(title.id, wikiResult.metadata, wikiResult.wikiUrl);
      if (dbResult.success) {
        // Track TMDB fallback separately
        if (wikiResult.source === "tmdb_fallback") {
          progress.incrementStat("wiki", "tmdbFallback");
        } else {
          progress.incrementStat("wiki", "success");
        }
        
        enrichedData.vibesScored = wikiResult.metadata.vibes;
        Object.assign(enrichedData, wikiResult.metadata);
        
        // Log top vibes with source indicator
        const topVibes = Object.entries(wikiResult.metadata.vibes || {})
          .filter(([_, score]) => score >= 0.3)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([v, s]) => `${v}: ${s.toFixed(2)}`)
          .join(", ");
        
        const sourceLabel = wikiResult.source === "tmdb_fallback" ? "TMDB fallback" : "Wiki";
        console.log(`  ✓ ${sourceLabel} enriched: ${topVibes || "(no significant vibes)"}`);
      } else {
        progress.incrementStat("wiki", "failed");
        failures.logFailure(title.id, title.title, "wiki_db", dbResult.error);
        console.log(`  ✗ Wiki DB update failed: ${dbResult.error}`);
      }
    } else if (wikiResult.error === "No Wikipedia or TMDB content found") {
      progress.incrementStat("wiki", "noContent");
      enrichedData.vibesScored = wikiResult.metadata?.vibes || null;
      console.log("  ⚠️  No Wikipedia or TMDB content found");
    } else {
      progress.incrementStat("wiki", "failed");
      failures.logFailure(title.id, title.title, "wiki", wikiResult.error);
      console.log(`  ✗ Wiki failed: ${wikiResult.error}`);
    }

    // Store enriched data for embedding generation
    enrichedTitles.push(enrichedData);

    // Mark as processed and checkpoint
    progress.markProcessed(title.id);
    progress.increment("success");

    // Checkpoint every N titles
    if ((i + 1) % CONFIG.pipeline.checkpointFrequency === 0) {
      progress.setCheckpoint(i);
      progress.print();
    }

    console.log("");
  }

  // Final checkpoint
  progress.setCheckpoint(titles.length - 1);

  // ============================================================================
  // Stage 3: Generate Embeddings
  // ============================================================================
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🧠 STAGE 3: Generating Embeddings");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Generate embedding texts
  console.log("📝 Generating embedding texts...");
  const vibeTexts = enrichedTitles.map((t) => generateVibeEmbeddingText(t));
  const contentTexts = enrichedTitles.map((t) => generateContentEmbeddingText(t));
  const metadataTexts = enrichedTitles.map((t) => generateMetadataEmbeddingText(t));

  // Log sample embedding texts
  if (enrichedTitles.length > 0) {
    console.log("\n📄 Sample embedding texts (first title):");
    console.log(`  Vibe: ${vibeTexts[0]?.substring(0, 100)}...`);
    console.log(`  Content: ${contentTexts[0]?.substring(0, 100)}...`);
    console.log(`  Metadata: ${metadataTexts[0]?.substring(0, 100)}...`);
  }

  // Generate embeddings in chunks
  console.log("\n🔄 Generating embeddings with OpenAI...\n");
  
  console.log("  🎭 Generating vibe embeddings...");
  const vibeEmbeddings = await generateEmbeddingsChunked(vibeTexts, "Vibe embeddings");
  
  console.log("  📖 Generating content embeddings...");
  const contentEmbeddings = await generateEmbeddingsChunked(contentTexts, "Content embeddings");
  
  console.log("  🏷️  Generating metadata embeddings...");
  const metadataEmbeddings = await generateEmbeddingsChunked(metadataTexts, "Metadata embeddings");

  // Prepare titles with embeddings for batch update
  const titlesWithEmbeddings = [];
  
  for (let i = 0; i < enrichedTitles.length; i++) {
    const vibeEmb = vibeEmbeddings[i];
    const contentEmb = contentEmbeddings[i];
    const metadataEmb = metadataEmbeddings[i];

    if (vibeEmb && contentEmb && metadataEmb) {
      progress.incrementStat("embeddings", "generated");
      titlesWithEmbeddings.push({
        id: enrichedTitles[i].id,
        title: enrichedTitles[i].title,
        embeddings: {
          vibe: vibeEmb,
          content: contentEmb,
          metadata: metadataEmb,
        },
      });
    } else {
      progress.incrementStat("embeddings", "failed");
      failures.logFailure(enrichedTitles[i].id, enrichedTitles[i].title, "embeddings", "Failed to generate one or more embeddings");
      // Mark as failed in database so it can be retried later
      await markEnrichmentFailed(enrichedTitles[i].id);
    }
  }

  console.log(`\n✅ Generated embeddings for ${titlesWithEmbeddings.length} titles`);
  if (progress.getStats().embeddings.failed > 0) {
    console.log(`⚠️  Failed to generate embeddings for ${progress.getStats().embeddings.failed} titles`);
  }

  // ============================================================================
  // Stage 4: Write Embeddings to Database
  // ============================================================================
  
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("💾 STAGE 4: Writing Embeddings to Database");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (titlesWithEmbeddings.length > 0) {
    const { success, failed } = await updateEmbeddingsBatch(titlesWithEmbeddings);
    console.log(`\n✅ Successfully wrote ${success} embeddings to database`);
    if (failed > 0) {
      console.log(`⚠️  Failed to write ${failed} embeddings`);
    }
  } else {
    console.log("⚠️  No embeddings to write");
  }

  // ============================================================================
  // Final Summary
  // ============================================================================

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  
  progress.printSummary();
  
  // Print failure summary if there are failures
  if (failures.getFailureCount() > 0) {
    failures.printSummary();
  }

  console.log(`📁 Progress file: clean/logs/enrichment-pipeline-progress.json`);
  console.log(`📁 Failure log: ${failures.failureFile}`);
  console.log("");
  console.log("💡 Next steps:");
  console.log("   - Run with --resume to continue processing more titles");
  console.log("   - Run with --clear to start a fresh run");
  console.log("   - Check failure log for titles that need manual attention");
  console.log("");
}

// Run the pipeline
runPipeline().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
