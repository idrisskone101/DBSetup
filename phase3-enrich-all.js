// Phase 3: Enrich All Titles
// Enriches all titles with semantic metadata and generates embeddings
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import { extractMetadata } from "./llm-extractor.js";
import { getWikiContent } from "./wikipedia-fetcher.js";
import { generateMultiEmbeddings } from "./embeddings.js";
import { synthesizeProfile } from "./llm-profile-synthesizer.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "scaling-config.json"), "utf-8"),
);

const BATCH_SIZE = config.batch_sizes.enrichment.titles_per_batch;
const EMBEDDING_BATCH_SIZE = config.batch_sizes.embeddings.titles_per_batch;
const CHECKPOINT_FREQUENCY = config.batch_sizes.enrichment.checkpoint_frequency;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("🎨 Phase 3: Enrich All Titles");
console.log("━".repeat(60));
console.log("This phase will:");
console.log("  1. Fetch titles without enrichment");
console.log("  2. Extract Wikipedia content (when available)");
console.log("  3. Use LLM to extract semantic metadata");
console.log("  4. Generate multi-dimensional embeddings");
console.log("  5. Calculate quality scores");
console.log("  6. Log failures to enrichment_failures table");
console.log("━".repeat(60) + "\n");

/**
 * Log failure to database
 */
async function logFailure(
  titleId,
  phase,
  errorType,
  errorMessage,
  retryCount = 0,
) {
  try {
    await supabase.from("enrichment_failures").insert({
      title_id: titleId,
      phase,
      error_type: errorType,
      error_message: errorMessage,
      retry_count: retryCount,
    });
  } catch (error) {
    console.warn(
      `⚠️  Failed to log failure for title ${titleId}: ${error.message}`,
    );
  }
}

/**
 * Log progress to file
 */
function logProgress(stats) {
  const logDir = path.join(__dirname, config.logging.log_directory);
  const logFile = path.join(logDir, `phase3-enrichment-progress.json`);

  const logEntry = {
    phase: "3",
    timestamp: new Date().toISOString(),
    stats,
  };

  fs.writeFileSync(logFile, JSON.stringify(logEntry, null, 2));
}

/**
 * Get unenriched titles
 * A title is considered "unenriched" if it's missing ANY of these required fields:
 * - profile_string, themes, vibes, tone, pacing, slots (metadata)
 * - content_embedding, vibe_embedding, metadata_embedding (embeddings)
 *
 * @param {number} limit - Maximum number of titles to fetch
 * @param {number} skipRecentHours - Skip titles updated within this many hours (0 = no skip)
 */
async function getUnenrichedTitles(limit = 1000, skipRecentHours = 1) {
  console.log(
    `📊 Fetching unenriched titles (limit: ${limit}, skip recent: ${skipRecentHours}h)...`,
  );

  let query = supabase
    .from("titles")
    .select(
      "id, title, overview, kind, imdb_id, release_date, updated_at, genres",
    )
    .or(
      [
        "profile_string.is.null",
        "themes.is.null",
        "vibes.is.null",
        "tone.is.null",
        "pacing.is.null",
        "slots.is.null",
        "content_embedding.is.null",
        "vibe_embedding.is.null",
        "metadata_embedding.is.null",
      ].join(","),
    );

  // Only apply time filter if skipRecentHours > 0
  if (skipRecentHours > 0) {
    const skipTimestamp = new Date(
      Date.now() - skipRecentHours * 60 * 60 * 1000,
    ).toISOString();
    query = query.lt("updated_at", skipTimestamp);
  }

  const { data, error } = await query
    .order("popularity", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`❌ Failed to fetch titles: ${error.message}`);
    throw error;
  }

  const skipMsg =
    skipRecentHours > 0
      ? ` (excluding titles updated within ${skipRecentHours}h)`
      : "";
  console.log(`✅ Found ${data.length} unenriched titles${skipMsg}\n`);
  return data;
}

/**
 * Enrich a single title with Wikipedia content
 */
async function enrichTitle(title) {
  let content = null;
  let contentSource = "none";

  // Try Wikipedia first
  try {
    const year = title.release_date
      ? new Date(title.release_date).getFullYear()
      : null;
    const { summary, plot } = await getWikiContent(title.title, {
      year,
      kind: title.kind,
    });

    // Combine summary and plot for enrichment
    const wikiText = [summary, plot].filter(Boolean).join("\n\n");

    if (
      wikiText &&
      wikiText.length >= config.enrichment_tiers.tier1.min_text_length
    ) {
      content = wikiText;
      contentSource = "wikipedia";
    }
  } catch (error) {
    console.warn(
      `⚠️  Wikipedia fetch failed for ${title.title}: ${error.message}`,
    );
  }

  // Fall back to TMDB overview
  if (
    !content &&
    title.overview &&
    title.overview.length >= config.enrichment_tiers.tier2.min_text_length
  ) {
    content = title.overview;
    contentSource = "tmdb_overview";
  }

  // If no content, use inference mode
  if (!content) {
    content = `Title: ${title.title}\nType: ${title.kind}\nOverview: ${title.overview || "No overview available"}`;
    contentSource = "tmdb_inference";
  }

  // Extract metadata using LLM
  try {
    const metadata = await extractMetadata(content, title.title);

    // Synthesize profile string from metadata
    const year = title.release_date
      ? new Date(title.release_date).getFullYear()
      : null;
    const facts = {
      title: title.title,
      year: year || "unknown",
      genres: title.genres || [],
      kind: title.kind,
    };

    let profile_string = null;
    try {
      profile_string = await synthesizeProfile(facts, metadata);
      if (!profile_string) {
        console.warn(
          `  ⚠️  Profile synthesis returned null for ${title.title}`,
        );
      }
    } catch (profileError) {
      console.warn(
        `  ⚠️  Profile synthesis failed for ${title.title}: ${profileError.message}`,
      );
      // Continue without profile_string - it's optional
    }

    return {
      success: true,
      titleId: title.id,
      metadata: {
        slots: metadata.slots || {},
        themes: metadata.themes || [],
        vibes: metadata.vibes || [],
        tone: metadata.tone || null,
        pacing: metadata.pacing || null,
        profile_string: profile_string,
        content_source: contentSource,
      },
    };
  } catch (error) {
    await logFailure(title.id, "extraction", error.name, error.message);
    return {
      success: false,
      titleId: title.id,
      error: error.message,
    };
  }
}

/**
 * Update quality scores for enriched titles
 */
async function updateQualityScores() {
  console.log("📊 Updating quality scores...");

  try {
    await supabase.rpc("update_all_quality_scores");
    console.log("✅ Quality scores updated\n");
  } catch (error) {
    console.warn(`⚠️  Failed to update quality scores: ${error.message}`);
  }
}

/**
 * Process a batch of titles with atomic updates
 * Only updates database if BOTH metadata extraction AND embedding generation succeed
 */
async function processBatch(titles, stats) {
  console.log(`\n📦 Processing batch of ${titles.length} titles...`);

  for (const title of titles) {
    stats.processed++;

    try {
      console.log(
        `[${stats.processed}/${stats.total}] Enriching: ${title.title}`,
      );

      // Step 1: Extract metadata from Wikipedia/TMDB
      const enrichResult = await enrichTitle(title);

      if (!enrichResult.success) {
        console.error(`  ❌ Metadata extraction failed: ${enrichResult.error}`);
        stats.failed++;
        await sleep(500);
        continue;
      }

      console.log(`  ✅ Metadata extracted successfully`);

      // Step 2: Generate embeddings from the extracted metadata
      console.log(`  🤖 Generating embeddings...`);

      const titleDataForEmbedding = {
        id: title.id,
        title: title.title,
        overview: title.overview,
        profile_string: enrichResult.metadata.profile_string,
        slots: enrichResult.metadata.slots,
        themes: enrichResult.metadata.themes,
        vibes: enrichResult.metadata.vibes,
        tone: enrichResult.metadata.tone,
        pacing: enrichResult.metadata.pacing,
      };

      let embeddings;
      try {
        const embeddingResults = await generateMultiEmbeddings([
          titleDataForEmbedding,
        ]);
        embeddings = embeddingResults[0];

        if (
          !embeddings ||
          !embeddings.vibe ||
          !embeddings.content ||
          !embeddings.metadata
        ) {
          throw new Error("Embedding generation returned incomplete results");
        }

        console.log(`  ✅ Embeddings generated successfully`);
      } catch (embError) {
        console.error(`  ❌ Embedding generation failed: ${embError.message}`);
        await logFailure(
          title.id,
          "embeddings",
          embError.name,
          embError.message,
        );
        stats.embeddings_failed++;
        stats.failed++;
        await sleep(500);
        continue;
      }

      // Step 3: Atomic update - write BOTH metadata AND embeddings together
      try {
        const { error: updateError } = await supabase
          .from("titles")
          .update({
            // Metadata fields
            profile_string: enrichResult.metadata.profile_string,
            slots: enrichResult.metadata.slots,
            themes: enrichResult.metadata.themes,
            vibes: enrichResult.metadata.vibes,
            tone: enrichResult.metadata.tone,
            pacing: enrichResult.metadata.pacing,
            // Embedding fields
            content_embedding: embeddings.content,
            vibe_embedding: embeddings.vibe,
            metadata_embedding: embeddings.metadata,
            // Update timestamp
            updated_at: new Date().toISOString(),
          })
          .eq("id", title.id);

        if (updateError) {
          throw updateError;
        }

        console.log(`  ✅ Title fully enriched and saved to database`);
        stats.enriched++;
        stats.embeddings_generated++;
      } catch (dbError) {
        console.error(`  ❌ Database update failed: ${dbError.message}`);
        await logFailure(
          title.id,
          "database_update",
          dbError.name,
          dbError.message,
        );
        stats.failed++;
      }

      // Rate limiting
      await sleep(500);
    } catch (error) {
      console.error(`  ❌ Unexpected error: ${error.message}`);
      await logFailure(title.id, "unexpected_error", error.name, error.message);
      stats.failed++;
      await sleep(500);
    }
  }

  return stats;
}

/**
 * Main execution
 */
async function main() {
  try {
    const startTime = Date.now();

    const stats = {
      total: 0,
      processed: 0,
      enriched: 0,
      failed: 0,
      embeddings_generated: 0,
      embeddings_failed: 0,
    };

    // Process in batches until no more unenriched titles
    let hasMore = true;
    let iteration = 0;

    while (hasMore) {
      iteration++;

      console.log(`\n${"═".repeat(60)}`);
      console.log(`🔄 Iteration ${iteration}`);
      console.log("═".repeat(60));

      // Fetch next batch of unenriched titles
      // Use skipRecentHours = 0 to process all incomplete titles without time filtering
      const titles = await getUnenrichedTitles(BATCH_SIZE, 8);

      if (titles.length === 0) {
        hasMore = false;
        break;
      }

      stats.total += titles.length;

      // Process the batch
      await processBatch(titles, stats);

      // Log progress
      logProgress(stats);

      // Checkpoint: update quality scores periodically
      if (iteration % CHECKPOINT_FREQUENCY === 0) {
        await updateQualityScores();
      }

      console.log(
        `\n📊 Progress: ${stats.processed}/${stats.total} processed, ${stats.enriched} enriched, ${stats.failed} failed`,
      );
    }

    // Final quality score update
    await updateQualityScores();

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

    console.log("\n" + "━".repeat(60));
    console.log("✨ PHASE 3 COMPLETE");
    console.log("━".repeat(60));
    console.log("📊 Final Summary:");
    console.log(`   Total Processed: ${stats.processed}`);
    console.log(`   Successfully Enriched: ${stats.enriched}`);
    console.log(`   Failed: ${stats.failed}`);
    console.log(`   Embeddings Generated: ${stats.embeddings_generated}`);
    console.log(`   Embeddings Failed: ${stats.embeddings_failed}`);
    console.log(`   Duration: ${duration} minutes\n`);
    console.log("🎉 All titles enriched!");
    console.log("━".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Phase 3 failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
