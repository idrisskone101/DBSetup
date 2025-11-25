// Fix compound vibes - Re-enrich titles with poor quality vibes
// Targets titles with atomic vibes that should be compounds (e.g., "dark" + "comedy" → "dark comedy")
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import { extractMetadata, inferMetadataFromTMDB } from "./llm-extractor.js";
import { getWikiContent } from "./wikipedia-fetcher.js";
import { generateVibeEmbeddings } from "./embeddings.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 50; // Process 50 titles at a time
const SKIP_EMBEDDING_REGEN = process.argv.includes("--skip-embeddings");
const TARGET_IDS = process.argv
  .find((arg) => arg.startsWith("--ids="))
  ?.split("=")[1]
  ?.split(",")
  .map((id) => parseInt(id.trim()));

// ============================================================================
// VIBE QUALITY DETECTION
// ============================================================================

/**
 * Detect if a title has poor quality vibes that need fixing
 * @param {Object} title - Title row from database
 * @returns {Object} - { needsFix: boolean, reason: string, issues: Array }
 */
function detectPoorVibes(title) {
  const issues = [];
  const vibes = title.vibes || [];
  const genres = title.genres || [];
  const genresLower = genres.map((g) => g.toLowerCase());

  if (vibes.length === 0) {
    return { needsFix: false, reason: "No vibes to check", issues: [] };
  }

  // Issue 1: Atomic "dark" vibe without compound
  const hasDark = vibes.some((v) => v.toLowerCase() === "dark");
  const hasComedy =
    vibes.some((v) => v.toLowerCase() === "comedy") ||
    genresLower.includes("comedy");
  const hasHorror =
    vibes.some((v) => v.toLowerCase() === "horror") ||
    genresLower.includes("horror");
  const hasThriller =
    vibes.some((v) => v.toLowerCase() === "thriller") ||
    genresLower.includes("thriller");

  if (
    hasDark &&
    hasComedy &&
    !vibes.some((v) => v.toLowerCase().includes("dark comedy"))
  ) {
    issues.push(
      'Has "dark" + "comedy" as separate vibes (should be "dark comedy")',
    );
  }

  if (
    hasDark &&
    hasHorror &&
    !vibes.some(
      (v) =>
        v.toLowerCase().includes("dark") && v.toLowerCase().includes("horror"),
    )
  ) {
    issues.push('Has "dark" + "horror" as separate vibes (should be compound)');
  }

  // Issue 2: Standalone forbidden vibes
  const FORBIDDEN_STANDALONE = [
    "comedy",
    "horror",
    "thriller",
    "drama",
    "action",
    "dark",
    "psychological",
    "romantic",
  ];

  const forbiddenFound = vibes.filter((v) =>
    FORBIDDEN_STANDALONE.includes(v.toLowerCase()),
  );
  if (forbiddenFound.length > 0) {
    issues.push(
      `Contains forbidden standalone vibes: ${forbiddenFound.join(", ")}`,
    );
  }

  // Issue 3: Vibes that just duplicate genres
  const duplicateGenres = vibes.filter((v) =>
    genresLower.includes(v.toLowerCase()),
  );
  if (duplicateGenres.length > 0) {
    issues.push(`Vibes duplicate genres: ${duplicateGenres.join(", ")}`);
  }

  // Issue 4: Too many single-word vibes
  const singleWordVibes = vibes.filter((v) => v.split(/\s+/).length === 1);
  if (singleWordVibes.length >= vibes.length * 0.6) {
    issues.push(
      `Too many single-word vibes (${singleWordVibes.length}/${vibes.length})`,
    );
  }

  return {
    needsFix: issues.length > 0,
    reason: issues.length > 0 ? issues[0] : "Vibes look good",
    issues,
  };
}

// ============================================================================
// DATA FETCHING
// ============================================================================

/**
 * Fetch titles that need vibe fixes
 * @param {number} limit - Max titles to fetch
 * @returns {Promise<Array>} - Array of title rows
 */
async function fetchTitlesNeedingFix(limit = 100) {
  console.log("🔍 Scanning database for titles with poor vibes...\n");

  const needsFix = [];
  const stats = {
    total: 0,
    darkComedy: 0,
    forbiddenStandalone: 0,
    duplicateGenres: 0,
    tooManySingleWord: 0,
  };

  // Fetch in smaller batches to avoid timeout
  const BATCH_SIZE = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore && needsFix.length < limit) {
    console.log(`  Fetching batch at offset ${offset}...`);

    // Fetch titles with vibes - use specific columns to reduce data transfer
    const { data: titles, error } = await supabase
      .from("titles")
      .select(
        "id, title, vibes, genres, wiki_source_url, kind, release_date, runtime_minutes, themes, tone, pacing, slots, overview, tagline",
      )
      .not("vibes", "is", null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch titles: ${error.message}`);
    }

    if (!titles || titles.length === 0) {
      hasMore = false;
      break;
    }

    stats.total += titles.length;

    // Filter titles that need fixes
    for (const title of titles) {
      if (needsFix.length >= limit) {
        hasMore = false;
        break;
      }

      const analysis = detectPoorVibes(title);

      if (analysis.needsFix) {
        needsFix.push({
          ...title,
          _fixAnalysis: analysis,
        });

        // Track issue types
        for (const issue of analysis.issues) {
          if (issue.includes("dark")) stats.darkComedy++;
          if (issue.includes("forbidden")) stats.forbiddenStandalone++;
          if (issue.includes("duplicate")) stats.duplicateGenres++;
          if (issue.includes("single-word")) stats.tooManySingleWord++;
        }
      }
    }

    offset += BATCH_SIZE;

    // Stop if we got fewer results than requested (end of data)
    if (titles.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  console.log(`\n📊 Scanned ${stats.total} titles`);
  console.log(`📋 Found ${needsFix.length} titles needing fixes:`);
  console.log(`   • Dark comedy issues: ${stats.darkComedy}`);
  console.log(`   • Forbidden standalone vibes: ${stats.forbiddenStandalone}`);
  console.log(`   • Duplicate genre vibes: ${stats.duplicateGenres}`);
  console.log(`   • Too many single-word vibes: ${stats.tooManySingleWord}`);
  console.log();

  return needsFix;
}

// ============================================================================
// RE-ENRICHMENT
// ============================================================================

/**
 * Re-enrich a single title's metadata
 * @param {Object} title - Title row from database
 * @returns {Promise<Object>} - New metadata or null if failed
 */
async function reenrichTitle(title) {
  try {
    let newMetadata = null;

    // Try Wikipedia first (best quality)
    if (title.wiki_source_url) {
      console.log(`  📖 Re-extracting from Wikipedia...`);

      // Extract title from Wikipedia URL
      const urlParts = title.wiki_source_url.split("/");
      const wikiTitle = decodeURIComponent(urlParts[urlParts.length - 1]);

      const wikiContent = await getWikiContent(wikiTitle);

      if (wikiContent && wikiContent.combinedText) {
        const facts = {
          title: title.title,
          year: title.release_date ? title.release_date.slice(0, 4) : null,
          kind: title.kind,
          genres: title.genres || [],
          runtime_minutes: title.runtime_minutes,
        };

        newMetadata = await extractMetadata(wikiContent.combinedText, facts);
      }
    }

    // Fallback to TMDB inference if Wikipedia failed
    if (!newMetadata || newMetadata.vibes.length === 0) {
      console.log(`  🎬 Inferring from TMDB data...`);
      newMetadata = await inferMetadataFromTMDB(title);
    }

    return newMetadata;
  } catch (error) {
    console.error(`  ❌ Re-enrichment failed: ${error.message}`);
    return null;
  }
}

/**
 * Process a batch of titles
 * @param {Array} batch - Array of title rows
 * @returns {Promise<Object>} - Stats about the batch
 */
async function processBatch(batch) {
  const stats = {
    processed: 0,
    improved: 0,
    failed: 0,
    skipped: 0,
    embeddingsRegenerated: 0,
  };

  for (const title of batch) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`🎬 ${title.title} (ID: ${title.id})`);
    console.log(`   Issues: ${title._fixAnalysis.issues.join("; ")}`);
    console.log(`   Old vibes: ${title.vibes.join(", ")}`);

    // Re-enrich
    const newMetadata = await reenrichTitle(title);

    if (!newMetadata) {
      console.log(`  ⚠️  Skipping - re-enrichment failed`);
      stats.failed++;
      continue;
    }

    console.log(`   New vibes: ${newMetadata.vibes.join(", ")}`);

    // Check if vibes actually improved
    const oldAnalysis = detectPoorVibes(title);
    const newAnalysis = detectPoorVibes({
      ...title,
      vibes: newMetadata.vibes,
    });

    if (newAnalysis.issues.length >= oldAnalysis.issues.length) {
      console.log(
        `  ⚠️  Skipping - new vibes not better (${newAnalysis.issues.length} issues vs ${oldAnalysis.issues.length})`,
      );
      stats.skipped++;
      continue;
    }

    console.log(
      `  ✅ Improved! Issues reduced from ${oldAnalysis.issues.length} to ${newAnalysis.issues.length}`,
    );

    // Update database
    if (!DRY_RUN) {
      const updateData = {
        vibes: newMetadata.vibes,
        themes:
          newMetadata.themes.length > 0 ? newMetadata.themes : title.themes,
        tone: newMetadata.tone || title.tone,
        pacing: newMetadata.pacing || title.pacing,
        slots: newMetadata.slots
          ? Object.values(newMetadata.slots).some(Boolean)
            ? newMetadata.slots
            : title.slots
          : title.slots,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from("titles")
        .update(updateData)
        .eq("id", title.id);

      if (updateError) {
        console.error(`  ❌ Database update failed: ${updateError.message}`);
        stats.failed++;
        continue;
      }

      // Regenerate vibe embedding if not skipped
      if (!SKIP_EMBEDDING_REGEN) {
        console.log(`  🤖 Regenerating vibe embedding...`);

        const titleWithNewData = { ...title, ...updateData };
        const [newEmbedding] = await generateVibeEmbeddings([titleWithNewData]);

        if (newEmbedding) {
          const { error: embError } = await supabase
            .from("titles")
            .update({ vibe_embedding: newEmbedding })
            .eq("id", title.id);

          if (!embError) {
            stats.embeddingsRegenerated++;
            console.log(`  ✅ Vibe embedding regenerated`);
          } else {
            console.error(`  ⚠️  Embedding update failed: ${embError.message}`);
          }
        }
      }
    } else {
      console.log(`  🔍 DRY RUN - would update database`);
    }

    stats.improved++;
    stats.processed++;

    // Rate limit between titles
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return stats;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║          FIX COMPOUND VIBES - RE-ENRICHMENT TOOL             ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝\n",
  );

  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE - No changes will be made to the database\n");
  }

  if (SKIP_EMBEDDING_REGEN) {
    console.log(
      "⚠️  SKIP EMBEDDINGS MODE - Vibe embeddings will NOT be regenerated\n",
    );
  }

  // Fetch titles needing fixes
  let titlesToFix;

  if (TARGET_IDS) {
    console.log(`🎯 Targeting specific IDs: ${TARGET_IDS.join(", ")}\n`);
    const { data, error } = await supabase
      .from("titles")
      .select("*")
      .in("id", TARGET_IDS);

    if (error)
      throw new Error(`Failed to fetch target titles: ${error.message}`);

    titlesToFix = data.map((title) => ({
      ...title,
      _fixAnalysis: detectPoorVibes(title),
    }));
  } else {
    titlesToFix = await fetchTitlesNeedingFix();
  }

  if (titlesToFix.length === 0) {
    console.log(
      "✅ No titles need fixing! Your vibes are already high quality.\n",
    );
    return;
  }

  // Show summary and get confirmation
  console.log(`\n📊 SUMMARY:`);
  console.log(`   Titles to fix: ${titlesToFix.length}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(
    `   Estimated batches: ${Math.ceil(titlesToFix.length / BATCH_SIZE)}`,
  );
  console.log(`   Estimated LLM calls: ${titlesToFix.length}`);
  console.log(
    `   Estimated cost: $${(titlesToFix.length * 0.015 + (SKIP_EMBEDDING_REGEN ? 0 : titlesToFix.length * 0.00002)).toFixed(2)}`,
  );
  console.log();

  // Process in batches
  const totalStats = {
    processed: 0,
    improved: 0,
    failed: 0,
    skipped: 0,
    embeddingsRegenerated: 0,
  };

  for (let i = 0; i < titlesToFix.length; i += BATCH_SIZE) {
    const batch = titlesToFix.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(titlesToFix.length / BATCH_SIZE);

    console.log(`\n${"═".repeat(80)}`);
    console.log(
      `📦 BATCH ${batchNum}/${totalBatches} (${batch.length} titles)`,
    );
    console.log("═".repeat(80));

    const batchStats = await processBatch(batch);

    // Update totals
    totalStats.processed += batchStats.processed;
    totalStats.improved += batchStats.improved;
    totalStats.failed += batchStats.failed;
    totalStats.skipped += batchStats.skipped;
    totalStats.embeddingsRegenerated += batchStats.embeddingsRegenerated;

    console.log(`\n📊 Batch ${batchNum} complete:`);
    console.log(`   Processed: ${batchStats.processed}`);
    console.log(`   Improved: ${batchStats.improved}`);
    console.log(`   Skipped: ${batchStats.skipped}`);
    console.log(`   Failed: ${batchStats.failed}`);
    if (!SKIP_EMBEDDING_REGEN) {
      console.log(
        `   Embeddings regenerated: ${batchStats.embeddingsRegenerated}`,
      );
    }
  }

  // Final summary
  console.log(`\n${"═".repeat(80)}`);
  console.log("✅ RE-ENRICHMENT COMPLETE");
  console.log("═".repeat(80));
  console.log(`📊 Final Statistics:`);
  console.log(`   Total processed: ${totalStats.processed}`);
  console.log(`   Improved: ${totalStats.improved}`);
  console.log(`   Skipped (no improvement): ${totalStats.skipped}`);
  console.log(`   Failed: ${totalStats.failed}`);
  if (!SKIP_EMBEDDING_REGEN) {
    console.log(
      `   Embeddings regenerated: ${totalStats.embeddingsRegenerated}`,
    );
  }
  console.log(
    `\n   Success rate: ${((totalStats.improved / titlesToFix.length) * 100).toFixed(1)}%`,
  );
  console.log();
}

// Execute
main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
