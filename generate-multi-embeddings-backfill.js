import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import {
  generateVibeEmbeddings,
  generateContentEmbeddings,
  generateMetadataEmbeddings,
} from "./embeddings.js";

const BATCH_SIZE = 100; // Process 100 titles at a time (well under OpenAI's 2048 limit)

/**
 * Backfill all 3 embeddings (vibe, content, metadata) for existing titles in the database
 * Fetches ALL titles and generates all 3 embedding types in batches
 */
async function backfillMultiEmbeddings() {
  console.log("🚀 Starting multi-embeddings backfill process...\n");
  console.log("📊 This will generate 3 embeddings per title:");
  console.log("   🎭 Vibe Embedding (emotional/atmospheric)");
  console.log("   📖 Content Embedding (story/narrative)");
  console.log("   🏷️  Metadata Embedding (factual/categorical)\n");

  try {
    // Fetch ALL titles (we want to regenerate all embeddings)
    // Only select columns needed for embedding generation (not existing embeddings)
    console.log("📊 Fetching all titles from database...");
    const { data: titles, error } = await supabase
      .from("titles")
      .select(
        `
        id,
        title,
        kind,
        overview,
        profile_string,
        vibes,
        themes,
        tone,
        pacing,
        tagline,
        genres,
        director,
        writers,
        creators,
        certification,
        production_countries,
        collection_name,
        keywords,
        slots
      `,
      )
      .order("id");

    if (error) {
      throw new Error(`Failed to fetch titles: ${error.message}`);
    }

    if (!titles || titles.length === 0) {
      console.log("ℹ️  No titles found in database.");
      return;
    }

    console.log(`📝 Found ${titles.length} title(s) to process\n`);
    console.log(
      `💰 Estimated cost: ~$${((titles.length * 3 * 0.00013) / 10).toFixed(4)} USD\n`,
    );

    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    const failedTitles = [];

    // Process titles in batches
    for (let i = 0; i < titles.length; i += BATCH_SIZE) {
      const batch = titles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(titles.length / BATCH_SIZE);

      console.log(`\n${"━".repeat(60)}`);
      console.log(
        `📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} titles)`,
      );
      console.log("━".repeat(60));

      try {
        // Generate all 3 embedding types for this batch
        console.log("\n🔄 Generating embeddings...");
        const [vibeEmbeddings, contentEmbeddings, metadataEmbeddings] =
          await Promise.all([
            generateVibeEmbeddings(batch),
            generateContentEmbeddings(batch),
            generateMetadataEmbeddings(batch),
          ]);

        console.log("\n💾 Updating database...");

        // Update each title individually with all 3 embeddings
        let updateCount = 0;
        for (let j = 0; j < batch.length; j++) {
          const title = batch[j];
          const vibeEmbedding = vibeEmbeddings[j];
          const contentEmbedding = contentEmbeddings[j];
          const metadataEmbedding = metadataEmbeddings[j];

          // Skip if any embedding generation failed
          if (
            vibeEmbedding === null ||
            contentEmbedding === null ||
            metadataEmbedding === null
          ) {
            console.warn(
              `⚠️  Skipping title ${title.id} (${title.title}) - embedding generation failed`,
            );
            failedTitles.push({ id: title.id, title: title.title });
            continue;
          }

          // Update all 3 embeddings at once
          const { error: updateError } = await supabase
            .from("titles")
            .update({
              vibe_embedding: vibeEmbedding,
              content_embedding: contentEmbedding,
              metadata_embedding: metadataEmbedding,
              updated_at: new Date().toISOString(),
            })
            .eq("id", title.id);

          if (updateError) {
            console.error(
              `❌ Failed to update title ${title.id} (${title.title}): ${updateError.message}`,
            );
            failedTitles.push({ id: title.id, title: title.title });
            continue;
          }

          updateCount++;
        }

        if (updateCount > 0) {
          successCount += updateCount;
          console.log(
            `✅ Successfully updated ${updateCount} title(s) with all 3 embeddings`,
          );
        }

        const failedInBatch = batch.length - updateCount;
        if (failedInBatch > 0) {
          failedCount += failedInBatch;
          console.warn(`⚠️  Failed to update ${failedInBatch} title(s)`);
        }

        processedCount += batch.length;

        // Progress update
        const progressPct = Math.round((processedCount / titles.length) * 100);
        console.log(
          `📈 Progress: ${processedCount}/${titles.length} (${progressPct}%)`,
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

        // Add all titles in failed batch to failed list
        batch.forEach((title) => {
          failedTitles.push({ id: title.id, title: title.title });
        });
      }
    }

    // Final summary
    console.log("\n" + "━".repeat(60));
    console.log("✨ MULTI-EMBEDDINGS BACKFILL COMPLETE");
    console.log("━".repeat(60));
    console.log(`📊 Total titles processed: ${processedCount}`);
    console.log(`✅ Successfully generated embeddings: ${successCount}`);
    console.log(`⚠️  Failed to generate embeddings: ${failedCount}`);
    console.log(`💾 Database now has 3 embedding types per title:`);
    console.log(`   🎭 vibe_embedding`);
    console.log(`   📖 content_embedding`);
    console.log(`   🏷️  metadata_embedding`);

    if (failedTitles.length > 0) {
      console.log(`\n⚠️  Failed titles (${failedTitles.length}):`);
      failedTitles.slice(0, 10).forEach((t) => {
        console.log(`   - ${t.id}: ${t.title}`);
      });
      if (failedTitles.length > 10) {
        console.log(`   ... and ${failedTitles.length - 10} more`);
      }
    }

    console.log("━".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Fatal error during backfill:", error);
    process.exit(1);
  }
}

/**
 * Backfill only missing embeddings (incremental mode)
 * Only processes titles that are missing at least one of the 3 embeddings
 */
async function backfillMissingEmbeddings() {
  console.log("🚀 Starting incremental multi-embeddings backfill...\n");
  console.log(
    "📊 This will only process titles missing at least one embedding type\n",
  );

  try {
    // Fetch titles missing any of the 3 embeddings
    // Only select columns needed for embedding generation
    console.log("📊 Fetching titles with missing embeddings...");
    const { data: titles, error } = await supabase
      .from("titles")
      .select(
        `
        id,
        title,
        kind,
        overview,
        profile_string,
        vibes,
        themes,
        tone,
        pacing,
        tagline,
        genres,
        director,
        writers,
        creators,
        certification,
        production_countries,
        collection_name,
        keywords,
        slots,
        vibe_embedding,
        content_embedding,
        metadata_embedding
      `,
      )
      .or(
        "vibe_embedding.is.null,content_embedding.is.null,metadata_embedding.is.null",
      )
      .order("id");

    if (error) {
      throw new Error(`Failed to fetch titles: ${error.message}`);
    }

    if (!titles || titles.length === 0) {
      console.log("✅ All titles have all 3 embeddings! Nothing to do.");
      return;
    }

    console.log(`📝 Found ${titles.length} title(s) with missing embeddings\n`);

    // Count what's missing
    const missingVibe = titles.filter((t) => !t.vibe_embedding).length;
    const missingContent = titles.filter((t) => !t.content_embedding).length;
    const missingMetadata = titles.filter((t) => !t.metadata_embedding).length;

    console.log("📊 Missing embeddings breakdown:");
    console.log(`   🎭 Vibe: ${missingVibe}`);
    console.log(`   📖 Content: ${missingContent}`);
    console.log(`   🏷️  Metadata: ${missingMetadata}\n`);

    // Run the same backfill logic but only for these titles
    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < titles.length; i += BATCH_SIZE) {
      const batch = titles.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(titles.length / BATCH_SIZE);

      console.log(
        `\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} titles)...`,
      );

      try {
        const [vibeEmbeddings, contentEmbeddings, metadataEmbeddings] =
          await Promise.all([
            generateVibeEmbeddings(batch),
            generateContentEmbeddings(batch),
            generateMetadataEmbeddings(batch),
          ]);

        let updateCount = 0;
        for (let j = 0; j < batch.length; j++) {
          const title = batch[j];
          const vibeEmbedding = vibeEmbeddings[j];
          const contentEmbedding = contentEmbeddings[j];
          const metadataEmbedding = metadataEmbeddings[j];

          if (
            vibeEmbedding === null ||
            contentEmbedding === null ||
            metadataEmbedding === null
          ) {
            console.warn(
              `⚠️  Skipping title ${title.id} - embedding generation failed`,
            );
            continue;
          }

          const { error: updateError } = await supabase
            .from("titles")
            .update({
              vibe_embedding: vibeEmbedding,
              content_embedding: contentEmbedding,
              metadata_embedding: metadataEmbedding,
              updated_at: new Date().toISOString(),
            })
            .eq("id", title.id);

          if (updateError) {
            console.error(
              `❌ Failed to update title ${title.id}: ${updateError.message}`,
            );
            continue;
          }

          updateCount++;
        }

        successCount += updateCount;
        failedCount += batch.length - updateCount;
        processedCount += batch.length;

        console.log(
          `📈 Progress: ${processedCount}/${titles.length} (${Math.round((processedCount / titles.length) * 100)}%)`,
        );

        if (i + BATCH_SIZE < titles.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`❌ Error processing batch ${batchNum}:`, error.message);
        failedCount += batch.length;
        processedCount += batch.length;
      }
    }

    console.log("\n" + "━".repeat(60));
    console.log("✨ INCREMENTAL BACKFILL COMPLETE");
    console.log("━".repeat(60));
    console.log(`📊 Total titles processed: ${processedCount}`);
    console.log(`✅ Successfully generated embeddings: ${successCount}`);
    console.log(`⚠️  Failed to generate embeddings: ${failedCount}`);
    console.log("━".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Fatal error during incremental backfill:", error);
    process.exit(1);
  }
}

// Main execution
const command = process.argv[2];

if (command === "--incremental") {
  backfillMissingEmbeddings().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  backfillMultiEmbeddings().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
