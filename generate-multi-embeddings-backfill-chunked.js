import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import {
  generateVibeEmbeddings,
  generateContentEmbeddings,
  generateMetadataEmbeddings,
} from "./embeddings.js";

const FETCH_CHUNK_SIZE = 50; // Fetch 50 titles at a time from database (avoids timeout)

/**
 * Backfill all 3 embeddings (vibe, content, metadata) for titles missing any embedding
 * Uses CHUNKED database fetching to avoid statement timeout errors
 * Processes in small batches to stay under the 2-minute database timeout
 */
async function backfillMissingEmbeddingsChunked() {
  console.log("🚀 Starting CHUNKED incremental multi-embeddings backfill...\n");
  console.log("📊 This will fetch titles in small chunks to avoid database timeouts\n");

  try {
    // First, get a count of how many titles need embeddings
    console.log("📊 Counting titles with missing embeddings...");
    const { count: totalMissing, error: countError } = await supabase
      .from("titles")
      .select("*", { count: "exact", head: true })
      .or("vibe_embedding.is.null,content_embedding.is.null,metadata_embedding.is.null");

    if (countError) {
      throw new Error(`Failed to count titles: ${countError.message}`);
    }

    if (totalMissing === 0) {
      console.log("✅ All titles have all 3 embeddings! Nothing to do.");
      return;
    }

    console.log(`📝 Found ${totalMissing} title(s) with missing embeddings\n`);
    console.log(`💰 Estimated cost: ~$${((totalMissing * 3 * 0.00013) / 10).toFixed(4)} USD\n`);

    let totalProcessed = 0;
    let successCount = 0;
    let failedCount = 0;
    const failedTitles = [];

    let offset = 0;
    let hasMore = true;
    let chunkNumber = 1;

    // Process titles in chunks to avoid database timeout
    while (hasMore) {
      console.log(`\n${"━".repeat(60)}`);
      console.log(`📦 Fetching chunk ${chunkNumber} (offset: ${offset}, limit: ${FETCH_CHUNK_SIZE})...`);
      console.log("━".repeat(60));

      // Fetch a small chunk of titles with missing embeddings
      const { data: titles, error } = await supabase
        .from("titles")
        .select("*")
        .or("vibe_embedding.is.null,content_embedding.is.null,metadata_embedding.is.null")
        .order("id")
        .range(offset, offset + FETCH_CHUNK_SIZE - 1);

      if (error) {
        console.error(`❌ Error fetching chunk ${chunkNumber}:`, error.message);
        // Don't throw - try to continue with next chunk
        offset += FETCH_CHUNK_SIZE;
        chunkNumber++;
        hasMore = offset < totalMissing;
        continue;
      }

      if (!titles || titles.length === 0) {
        console.log("✅ No more titles to process");
        hasMore = false;
        break;
      }

      console.log(`✅ Fetched ${titles.length} title(s) in chunk ${chunkNumber}`);

      // Show what's missing in this chunk
      const missingVibe = titles.filter((t) => !t.vibe_embedding).length;
      const missingContent = titles.filter((t) => !t.content_embedding).length;
      const missingMetadata = titles.filter((t) => !t.metadata_embedding).length;

      console.log(`📊 Missing in this chunk:`);
      console.log(`   🎭 Vibe: ${missingVibe}`);
      console.log(`   📖 Content: ${missingContent}`);
      console.log(`   🏷️  Metadata: ${missingMetadata}`);

      try {
        // Generate all 3 embedding types for this chunk
        console.log(`\n🔄 Generating embeddings for chunk ${chunkNumber}...`);
        const [vibeEmbeddings, contentEmbeddings, metadataEmbeddings] =
          await Promise.all([
            generateVibeEmbeddings(titles),
            generateContentEmbeddings(titles),
            generateMetadataEmbeddings(titles),
          ]);

        console.log("💾 Updating database...");

        // Update each title individually with all 3 embeddings
        let updateCount = 0;
        for (let i = 0; i < titles.length; i++) {
          const title = titles[i];
          const vibeEmbedding = vibeEmbeddings[i];
          const contentEmbedding = contentEmbeddings[i];
          const metadataEmbedding = metadataEmbeddings[i];

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
            failedCount++;
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
            failedCount++;
            continue;
          }

          updateCount++;
        }

        if (updateCount > 0) {
          successCount += updateCount;
          console.log(`✅ Successfully updated ${updateCount} title(s) with all 3 embeddings`);
        }

        const failedInChunk = titles.length - updateCount;
        if (failedInChunk > 0) {
          console.warn(`⚠️  Failed to update ${failedInChunk} title(s) in this chunk`);
        }

        totalProcessed += titles.length;

        // Progress update
        const progressPct = Math.round((totalProcessed / totalMissing) * 100);
        console.log(
          `📈 Overall Progress: ${totalProcessed}/${totalMissing} (${progressPct}%)`,
        );

        // Small delay between chunks to avoid rate limiting
        console.log("⏳ Waiting 2 seconds before next chunk...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`❌ Error processing chunk ${chunkNumber}:`, error.message);

        // Mark all titles in this chunk as failed
        titles.forEach((title) => {
          failedTitles.push({ id: title.id, title: title.title });
        });
        failedCount += titles.length;
        totalProcessed += titles.length;
      }

      // Move to next chunk
      offset += FETCH_CHUNK_SIZE;
      chunkNumber++;

      // Check if there are more titles to fetch
      hasMore = titles.length === FETCH_CHUNK_SIZE && totalProcessed < totalMissing;
    }

    // Final summary
    console.log("\n" + "━".repeat(60));
    console.log("✨ CHUNKED INCREMENTAL BACKFILL COMPLETE");
    console.log("━".repeat(60));
    console.log(`📊 Total titles processed: ${totalProcessed}`);
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
    console.error("\n❌ Fatal error during chunked backfill:", error);
    process.exit(1);
  }
}

// Main execution
backfillMissingEmbeddingsChunked().catch((e) => {
  console.error(e);
  process.exit(1);
});
