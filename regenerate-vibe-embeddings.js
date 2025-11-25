// Regenerate vibe embeddings for titles with updated vibes
// Use this after running fix-compound-vibes.js to update embeddings
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import { generateVibeEmbeddings } from "./embeddings.js";

const BATCH_SIZE = 100; // Process 100 at a time
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_ALL = process.argv.includes("--all");

/**
 * Fetch titles that need embedding regeneration
 * @returns {Promise<Array>} - Array of title rows
 */
async function fetchTitlesNeedingEmbeddings() {
  console.log("🔍 Fetching titles for embedding regeneration...\n");

  let query = supabase.from("titles").select("*");

  if (!FORCE_ALL) {
    // Only fetch titles updated in the last hour (likely from fix script)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    query = query.gte("updated_at", oneHourAgo);
  }

  const { data, error } = query;

  if (error) {
    throw new Error(`Failed to fetch titles: ${error.message}`);
  }

  console.log(`📊 Found ${data.length} titles to process\n`);
  return data;
}

/**
 * Process a batch of titles
 * @param {Array} batch - Array of title rows
 * @param {number} batchNum - Batch number
 * @returns {Promise<Object>} - Stats
 */
async function processBatch(batch, batchNum) {
  console.log(`📦 Batch ${batchNum}: Generating embeddings for ${batch.length} titles...`);

  const stats = {
    success: 0,
    failed: 0,
  };

  try {
    // Generate vibe embeddings
    const embeddings = await generateVibeEmbeddings(batch);

    if (!DRY_RUN) {
      // Update each title with its new embedding
      for (let i = 0; i < batch.length; i++) {
        const title = batch[i];
        const embedding = embeddings[i];

        if (!embedding) {
          console.log(`  ⚠️  ${title.title}: Embedding generation failed`);
          stats.failed++;
          continue;
        }

        const { error } = await supabase
          .from("titles")
          .update({ vibe_embedding: embedding })
          .eq("id", title.id);

        if (error) {
          console.error(`  ❌ ${title.title}: Update failed - ${error.message}`);
          stats.failed++;
        } else {
          stats.success++;
        }
      }
    } else {
      console.log(`  🔍 DRY RUN - Would update ${embeddings.filter(Boolean).length} embeddings`);
      stats.success = embeddings.filter(Boolean).length;
      stats.failed = embeddings.filter(e => !e).length;
    }

    console.log(`  ✅ Batch complete: ${stats.success} success, ${stats.failed} failed\n`);
  } catch (error) {
    console.error(`  ❌ Batch failed: ${error.message}\n`);
    stats.failed = batch.length;
  }

  return stats;
}

/**
 * Main execution
 */
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         REGENERATE VIBE EMBEDDINGS UTILITY                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE - No changes will be made\n");
  }

  if (FORCE_ALL) {
    console.log("⚠️  FORCE ALL MODE - Regenerating ALL title embeddings\n");
  } else {
    console.log("🕐 Targeting titles updated in the last hour\n");
  }

  // Fetch titles
  const titles = await fetchTitlesNeedingEmbeddings();

  if (titles.length === 0) {
    console.log("✅ No titles need embedding updates!\n");
    return;
  }

  // Process in batches
  const totalStats = {
    success: 0,
    failed: 0,
  };

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const batchStats = await processBatch(batch, batchNum);

    totalStats.success += batchStats.success;
    totalStats.failed += batchStats.failed;

    // Rate limit between batches
    if (i + BATCH_SIZE < titles.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Final summary
  console.log("═".repeat(80));
  console.log("✅ REGENERATION COMPLETE");
  console.log("═".repeat(80));
  console.log(`📊 Statistics:`);
  console.log(`   Total processed: ${titles.length}`);
  console.log(`   Success: ${totalStats.success}`);
  console.log(`   Failed: ${totalStats.failed}`);
  console.log(`   Success rate: ${((totalStats.success / titles.length) * 100).toFixed(1)}%`);
  console.log();
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
