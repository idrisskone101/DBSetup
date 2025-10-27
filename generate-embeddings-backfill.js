import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import { generateEmbeddings } from "./embeddings.js";

const BATCH_SIZE = 100; // Process 100 titles at a time (well under OpenAI's 2048 limit)

/**
 * Backfill embeddings for existing titles in the database
 * Fetches titles without embeddings and generates them in batches
 */
async function backfillEmbeddings() {
  console.log("🚀 Starting embeddings backfill process...\n");

  try {
    // Fetch all titles that don't have embeddings
    console.log("📊 Fetching titles without embeddings from database...");
    const { data: titles, error } = await supabase
      .from("titles")
      .select("*")
      .is("embedding", null)
      .order("id");

    if (error) {
      throw new Error(`Failed to fetch titles: ${error.message}`);
    }

    if (!titles || titles.length === 0) {
      console.log("✅ All titles already have embeddings! Nothing to do.");
      return;
    }

    console.log(`📝 Found ${titles.length} title(s) without embeddings\n`);

    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;

    // Process titles in batches
    for (let i = 0; i < titles.length; i += BATCH_SIZE) {
      const batch = titles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(titles.length / BATCH_SIZE);

      console.log(
        `\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} titles)...`,
      );

      try {
        // Generate embeddings for this batch
        const embeddings = await generateEmbeddings(batch);

        // Update each title individually using UPDATE query
        // This avoids NOT NULL constraint issues with upsert
        let updateCount = 0;
        for (let j = 0; j < batch.length; j++) {
          const title = batch[j];
          const embedding = embeddings[j];

          if (embedding === null) {
            console.warn(
              `⚠️  Skipping title ${title.id} - embedding generation failed`,
            );
            continue;
          }

          const { error: updateError } = await supabase
            .from("titles")
            .update({ embedding })
            .eq("id", title.id);

          if (updateError) {
            console.error(
              `❌ Failed to update title ${title.id}: ${updateError.message}`,
            );
            continue;
          }

          updateCount++;
        }

        if (updateCount > 0) {
          successCount += updateCount;
          console.log(`✅ Successfully updated ${updateCount} embedding(s)`);
        }

        const failedInBatch = batch.length - updateCount;
        if (failedInBatch > 0) {
          failedCount += failedInBatch;
          console.warn(`⚠️  Failed to update ${failedInBatch} embedding(s)`);
        }

        processedCount += batch.length;

        // Progress update
        console.log(
          `📈 Progress: ${processedCount}/${titles.length} (${Math.round((processedCount / titles.length) * 100)}%)`,
        );

        // Small delay between batches to avoid rate limiting
        if (i + BATCH_SIZE < titles.length) {
          console.log("⏳ Waiting 1 second before next batch...");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`❌ Error processing batch ${batchNum}:`, error.message);
        failedCount += batch.length;
        processedCount += batch.length;
      }
    }

    // Final summary
    console.log("\n" + "━".repeat(60));
    console.log("✨ BACKFILL COMPLETE");
    console.log("━".repeat(60));
    console.log(`📊 Total titles processed: ${processedCount}`);
    console.log(`✅ Successfully generated embeddings: ${successCount}`);
    console.log(`⚠️  Failed to generate embeddings: ${failedCount}`);
    console.log("━".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Fatal error during backfill:", error);
    process.exit(1);
  }
}

/**
 * Optional: Regenerate embeddings for ALL titles (even those that have embeddings)
 * Use with caution - this will cost more API credits
 */
async function regenerateAllEmbeddings() {
  console.log("🚀 Starting full embeddings regeneration...\n");
  console.log("⚠️  WARNING: This will regenerate embeddings for ALL titles!");
  console.log("   This may cost more API credits. Press Ctrl+C to cancel.\n");

  // Wait 5 seconds to allow cancellation
  console.log("⏳ Starting in 5 seconds...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  try {
    // Fetch ALL titles
    console.log("📊 Fetching all titles from database...");
    const { data: titles, error } = await supabase
      .from("titles")
      .select("*")
      .order("id");

    if (error) {
      throw new Error(`Failed to fetch titles: ${error.message}`);
    }

    if (!titles || titles.length === 0) {
      console.log("ℹ️  No titles found in database.");
      return;
    }

    console.log(`📝 Found ${titles.length} title(s) to process\n`);

    // Clear all existing embeddings first
    console.log("🗑️  Clearing existing embeddings...");
    const { error: clearError } = await supabase
      .from("titles")
      .update({ embedding: null })
      .not("id", "is", null);

    if (clearError) {
      throw new Error(`Failed to clear embeddings: ${clearError.message}`);
    }

    console.log("✅ Embeddings cleared. Starting generation...\n");

    // Now run the normal backfill process
    await backfillEmbeddings();
  } catch (error) {
    console.error("\n❌ Fatal error during regeneration:", error);
    process.exit(1);
  }
}

// Main execution
const command = process.argv[2];

if (command === "--regenerate-all") {
  regenerateAllEmbeddings().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  backfillEmbeddings().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
