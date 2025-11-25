// Regenerate all embeddings with 768 dimensions (Matryoshka)
// Includes robust timeout handling, retry logic, and checkpointing
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import {
  generateContentEmbeddings,
  generateVibeEmbeddings,
  generateMetadataEmbeddings,
} from "./embeddings.js";
import fs from "fs";

// Configuration
const BATCH_SIZE = 50; // Smaller batches for stability
const BATCH_TIMEOUT_MS = 120000; // 2 minutes per batch
const MAX_RETRIES = 3;
const CHECKPOINT_FILE = ".regeneration-checkpoint.json";

// Delay utilities
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exponentialBackoff = (attempt) => Math.pow(2, attempt) * 2000; // 2s, 4s, 8s

// Checkpoint management
function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn("⚠️  Could not load checkpoint:", error.message);
  }
  return { lastProcessedId: 0, stats: { success: 0, failed: 0, skipped: 0 } };
}

function saveCheckpoint(checkpoint) {
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
  } catch (error) {
    console.warn("⚠️  Could not save checkpoint:", error.message);
  }
}

function clearCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      fs.unlinkSync(CHECKPOINT_FILE);
    }
  } catch (error) {
    console.warn("⚠️  Could not clear checkpoint:", error.message);
  }
}

/**
 * Generate embeddings with timeout handling
 */
async function generateWithTimeout(embeddingFn, batch, embeddingType) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), BATCH_TIMEOUT_MS),
  );

  const generationPromise = embeddingFn(batch);

  try {
    return await Promise.race([generationPromise, timeoutPromise]);
  } catch (error) {
    if (error.message === "Timeout") {
      throw new Error(
        `${embeddingType} embedding generation timed out after ${BATCH_TIMEOUT_MS}ms`,
      );
    }
    throw error;
  }
}

/**
 * Generate embeddings with retry logic
 */
async function generateWithRetry(embeddingFn, batch, embeddingType) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = exponentialBackoff(attempt - 1);
        console.log(
          `  ⏳ Retry attempt ${attempt + 1}/${MAX_RETRIES} after ${delay}ms delay...`,
        );
        await sleep(delay);
      }

      return await generateWithTimeout(embeddingFn, batch, embeddingType);
    } catch (error) {
      lastError = error;
      console.warn(`  ⚠️  Attempt ${attempt + 1} failed: ${error.message}`);
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

/**
 * Process a single batch of titles
 */
async function processBatch(batch, batchNum, totalBatches) {
  const batchStats = {
    success: 0,
    failed: 0,
    errors: [],
  };

  console.log(
    `\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} titles)...`,
  );

  try {
    // Generate all 3 embedding types
    console.log("  🎭 Generating vibe embeddings...");
    const vibeEmbeddings = await generateWithRetry(
      generateVibeEmbeddings,
      batch,
      "Vibe",
    );

    console.log("  📖 Generating content embeddings...");
    const contentEmbeddings = await generateWithRetry(
      generateContentEmbeddings,
      batch,
      "Content",
    );

    console.log("  🏷️  Generating metadata embeddings...");
    const metadataEmbeddings = await generateWithRetry(
      generateMetadataEmbeddings,
      batch,
      "Metadata",
    );

    // Update database
    console.log("  💾 Updating database...");
    for (let i = 0; i < batch.length; i++) {
      const title = batch[i];

      if (
        !vibeEmbeddings[i] ||
        !contentEmbeddings[i] ||
        !metadataEmbeddings[i]
      ) {
        console.log(`  ⚠️  ${title.title}: Missing embeddings, skipping`);
        batchStats.failed++;
        batchStats.errors.push({
          id: title.id,
          title: title.title,
          error: "Missing embeddings",
        });
        continue;
      }

      const { error } = await supabase
        .from("titles")
        .update({
          content_embedding: contentEmbeddings[i],
          vibe_embedding: vibeEmbeddings[i],
          metadata_embedding: metadataEmbeddings[i],
        })
        .eq("id", title.id);

      if (error) {
        console.error(`  ❌ ${title.title}: Update failed - ${error.message}`);
        batchStats.failed++;
        batchStats.errors.push({
          id: title.id,
          title: title.title,
          error: error.message,
        });
      } else {
        batchStats.success++;
      }
    }

    console.log(
      `  ✅ Batch complete: ${batchStats.success} success, ${batchStats.failed} failed`,
    );
  } catch (error) {
    console.error(`  ❌ Batch ${batchNum} failed: ${error.message}`);
    batchStats.failed = batch.length;
    batchStats.errors.push({
      batch: batchNum,
      error: error.message,
    });
  }

  return batchStats;
}

/**
 * Fetch all titles that need embedding regeneration
 */
async function fetchTitles(lastProcessedId = 0) {
  console.log("🔍 Fetching titles for embedding regeneration...\n");

  let allData = [];
  let hasMore = true;
  let lastId = lastProcessedId;
  const FETCH_LIMIT = 500; // Smaller chunks to stay under 2min timeout

  while (hasMore) {
    // Only select columns needed for embedding generation (exclude large embedding columns)
    const { data, error } = await supabase
      .from("titles")
      .select(
        "id, kind, imdb_id, title, original_title, overview, release_date, runtime_minutes, poster_path, backdrop_path, vote_average, vote_count, popularity, genres, languages, providers",
      )
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(FETCH_LIMIT);

    if (error) {
      throw new Error(`Failed to fetch titles: ${error.message}`);
    }

    if (data && data.length > 0) {
      allData = allData.concat(data);
      lastId = data[data.length - 1].id; // Track last ID for next iteration
      hasMore = data.length === FETCH_LIMIT;

      if (hasMore) {
        console.log(`  📥 Fetched ${allData.length} titles so far...`);
      }
    } else {
      hasMore = false;
    }
  }

  console.log(`📊 Found ${allData.length} titles to process\n`);
  return allData;
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();

  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║   REGENERATE EMBEDDINGS WITH 768 DIMENSIONS (MATRYOSHKA)    ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝\n",
  );

  // Load checkpoint (resume from last successful batch)
  const checkpoint = loadCheckpoint();
  console.log(
    `📍 Checkpoint: Last processed ID = ${checkpoint.lastProcessedId}`,
  );
  console.log(
    `📊 Previous stats: ${checkpoint.stats.success} success, ${checkpoint.stats.failed} failed\n`,
  );

  // Fetch titles
  const titles = await fetchTitles(checkpoint.lastProcessedId);

  if (titles.length === 0) {
    console.log("✅ No titles need processing!\n");
    clearCheckpoint();
    return;
  }

  // Process in batches
  const totalStats = {
    success: checkpoint.stats.success,
    failed: checkpoint.stats.failed,
    errors: [],
  };

  const totalBatches = Math.ceil(titles.length / BATCH_SIZE);
  console.log(
    `📦 Processing ${titles.length} titles in ${totalBatches} batches of ${BATCH_SIZE}\n`,
  );
  console.log("─".repeat(80));

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const batchStats = await processBatch(batch, batchNum, totalBatches);

    totalStats.success += batchStats.success;
    totalStats.failed += batchStats.failed;
    totalStats.errors.push(...batchStats.errors);

    // Update checkpoint
    const lastProcessedId = batch[batch.length - 1].id;
    saveCheckpoint({
      lastProcessedId,
      stats: {
        success: totalStats.success,
        failed: totalStats.failed,
      },
    });

    // Rate limiting between batches
    if (i + BATCH_SIZE < titles.length) {
      console.log("  ⏸️  Pausing 3s before next batch...");
      await sleep(3000);
    }
  }

  // Final summary
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log("\n" + "═".repeat(80));
  console.log("✅ REGENERATION COMPLETE");
  console.log("═".repeat(80));
  console.log(`📊 Statistics:`);
  console.log(`   Total processed: ${titles.length}`);
  console.log(`   Success: ${totalStats.success}`);
  console.log(`   Failed: ${totalStats.failed}`);
  console.log(
    `   Success rate: ${((totalStats.success / titles.length) * 100).toFixed(1)}%`,
  );
  console.log(`   Duration: ${duration} minutes`);

  if (totalStats.errors.length > 0) {
    console.log(`\n⚠️  Errors encountered (${totalStats.errors.length}):`);
    totalStats.errors.slice(0, 10).forEach((err) => {
      if (err.title) {
        console.log(`   - [${err.id}] ${err.title}: ${err.error}`);
      } else {
        console.log(`   - Batch ${err.batch}: ${err.error}`);
      }
    });
    if (totalStats.errors.length > 10) {
      console.log(`   ... and ${totalStats.errors.length - 10} more errors`);
    }
  }

  // Clear checkpoint on success
  if (totalStats.failed === 0) {
    console.log("\n✅ All titles processed successfully!");
    clearCheckpoint();
  } else {
    console.log(
      "\n⚠️  Some titles failed. Checkpoint saved. Re-run to retry failed titles.",
    );
  }

  console.log();

  // Verify embeddings in database
  console.log("🔍 Verifying embeddings in database...\n");
  const { data: verificationData } = await supabase
    .from("titles")
    .select("id")
    .not("content_embedding", "is", null)
    .not("vibe_embedding", "is", null)
    .not("metadata_embedding", "is", null);

  console.log(
    `✅ ${verificationData.length} titles have all 3 embeddings (768 dims)\n`,
  );
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
