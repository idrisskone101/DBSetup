// Chunked version - fetches titles in smaller batches to avoid timeouts
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import {
  generateVibeEmbeddings,
  generateContentEmbeddings,
  generateMetadataEmbeddings,
} from "./embeddings.js";

const FETCH_CHUNK_SIZE = 100; // Fetch 100 titles at a time from DB
const EMBEDDING_BATCH_SIZE = 50; // Process 50 at a time for embeddings

/**
 * Backfill embeddings in small chunks to avoid timeouts
 */
async function backfillEmbeddingsChunked() {
  console.log("🚀 Starting chunked multi-embeddings backfill...\n");

  try {
    // First, get the total count
    const { count, error: countError } = await supabase
      .from("titles")
      .select("id", { count: "exact", head: true });

    if (countError) {
      throw new Error(`Failed to count titles: ${countError.message}`);
    }

    console.log(`📊 Total titles in database: ${count}\n`);

    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    // Process in chunks
    for (let offset = 0; offset < count; offset += FETCH_CHUNK_SIZE) {
      console.log(`\n${"━".repeat(60)}`);
      console.log(`📦 Fetching chunk ${Math.floor(offset / FETCH_CHUNK_SIZE) + 1} (offset: ${offset})...`);

      // Fetch a chunk of titles
      const { data: chunk, error: fetchError } = await supabase
        .from("titles")
        .select(`
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
        `)
        .order("id")
        .range(offset, offset + FETCH_CHUNK_SIZE - 1);

      if (fetchError) {
        console.error(`❌ Failed to fetch chunk: ${fetchError.message}`);
        continue;
      }

      if (!chunk || chunk.length === 0) {
        console.log("✅ No more titles to process");
        break;
      }

      console.log(`   Found ${chunk.length} titles`);

      // Process this chunk in embedding batches
      for (let i = 0; i < chunk.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = chunk.slice(i, i + EMBEDDING_BATCH_SIZE);

        console.log(`   🔄 Generating embeddings for batch (${batch.length} titles)...`);

        try {
          const [vibeEmbeddings, contentEmbeddings, metadataEmbeddings] =
            await Promise.all([
              generateVibeEmbeddings(batch),
              generateContentEmbeddings(batch),
              generateMetadataEmbeddings(batch),
            ]);

          // Update each title
          let batchSuccess = 0;
          for (let j = 0; j < batch.length; j++) {
            const title = batch[j];

            if (
              vibeEmbeddings[j] === null ||
              contentEmbeddings[j] === null ||
              metadataEmbeddings[j] === null
            ) {
              console.warn(`   ⚠️  Skipping ${title.title} - embedding generation failed`);
              totalFailed++;
              continue;
            }

            const { error: updateError } = await supabase
              .from("titles")
              .update({
                vibe_embedding: vibeEmbeddings[j],
                content_embedding: contentEmbeddings[j],
                metadata_embedding: metadataEmbeddings[j],
                updated_at: new Date().toISOString(),
              })
              .eq("id", title.id);

            if (updateError) {
              console.error(`   ❌ Failed to update ${title.title}: ${updateError.message}`);
              totalFailed++;
            } else {
              batchSuccess++;
            }
          }

          totalSuccess += batchSuccess;
          totalProcessed += batch.length;

          console.log(`   ✅ Updated ${batchSuccess}/${batch.length} titles`);

          // Small delay
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`   ❌ Error processing embedding batch: ${error.message}`);
          totalFailed += batch.length;
          totalProcessed += batch.length;
        }
      }

      console.log(`📈 Overall Progress: ${totalProcessed}/${count} (${Math.round((totalProcessed / count) * 100)}%)`);
    }

    console.log("\n" + "━".repeat(60));
    console.log("✨ CHUNKED BACKFILL COMPLETE");
    console.log("━".repeat(60));
    console.log(`📊 Total processed: ${totalProcessed}`);
    console.log(`✅ Success: ${totalSuccess}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log("━".repeat(60) + "\n");

  } catch (error) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
}

backfillEmbeddingsChunked();
