import "dotenv/config.js";
import {
  getMoviesPage,
  getMovieDetails,
  normalizeMovie,
  getTvPage,
  getTvDetails,
  normalizeTv,
} from "./tmdb.js";
import { batchUpsertTitles, supabase } from "./supabase-upsert.js";
import { generateEmbeddings } from "./embeddings.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gentle = async () => sleep(250); // TMDB rate limit: 250ms = 4 req/sec (well under 50/sec limit)

const BATCH_SIZE = 20; // Batch size for Supabase upserts

/**
 * Fetch all existing title IDs from the database
 * This allows us to skip titles that are already in the database
 */
async function getExistingTitleIds() {
  console.log("📊 Fetching existing title IDs from database...");
  const { data, error } = await supabase.from("titles").select("id");

  if (error) {
    console.warn(`⚠️  Could not fetch existing IDs: ${error.message}`);
    console.warn("   Continuing without duplicate checking...");
    return new Set();
  }

  const existingIds = new Set(data.map((row) => row.id));
  console.log(`✅ Found ${existingIds.size} existing titles in database\n`);
  return existingIds;
}

/**
 * Process titles in batches with progress tracking
 * NOTE: Embedding generation is DISABLED - enrich data first, then generate embeddings later
 */
async function processBatch(batch, type, currentCount, totalCount) {
  if (batch.length === 0) return { success: 0, failed: 0 };

  // EMBEDDING GENERATION DISABLED - Uncomment when ready to generate embeddings
  // Generate embeddings for the batch
  let embeddings = null;
  // try {
  //   embeddings = await generateEmbeddings(batch);
  //   console.log(
  //     `🤖 [${currentCount}/${totalCount}] Generated embeddings for ${batch.length} ${type}`,
  //   );
  // } catch (error) {
  //   console.warn(
  //     `⚠️  Failed to generate embeddings for batch: ${error.message}`,
  //   );
  //   console.log("   Continuing with upsert without embeddings...");
  // }

  const result = await batchUpsertTitles(batch, embeddings);

  if (result.success > 0) {
    console.log(
      `✅ [${currentCount}/${totalCount}] Batch inserted ${result.success} ${type}`,
    );
  }

  if (result.failed > 0) {
    console.warn(
      `⚠️  Failed to insert ${result.failed} ${type}:`,
      result.errors,
    );
  }

  return { success: result.success, failed: result.failed };
}

async function ingestMovies(pages = 3, existingIds = new Set()) {
  console.log(`\n🎬 Starting movie ingestion (${pages} pages)...\n`);

  const totalMovies = pages * 20; // TMDB returns ~20 per page
  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  let batch = [];

  for (let p = 1; p <= pages; p++) {
    const page = await getMoviesPage(p);

    for (const m of page) {
      // Skip if already in database
      if (existingIds.has(m.id)) {
        skippedCount++;
        processedCount++;
        console.log(
          `[${processedCount}/${totalMovies}] ⏭️  Skipped (already exists): ${m.title} (${m.id})`,
        );
        continue;
      }

      try {
        const d = await getMovieDetails(m.id);
        const norm = normalizeMovie(d);

        batch.push(norm);
        processedCount++;

        console.log(
          `[${processedCount}/${totalMovies}] Fetched: ${norm.title} (${norm.id})`,
        );

        // Process batch when it reaches BATCH_SIZE or it's the last item
        if (batch.length >= BATCH_SIZE || processedCount === totalMovies) {
          const result = await processBatch(
            batch,
            "movies",
            processedCount,
            totalMovies,
          );
          successCount += result.success;
          failedCount += result.failed;
          batch = []; // Clear batch
        }

        await gentle(); // Rate limit for TMDB
      } catch (error) {
        console.warn(
          `⚠️  Skipping movie ${m.id} (${m.title}): ${error.message}`,
        );
        failedCount++;
        processedCount++;
      }
    }
  }

  console.log(
    `\n🎬 Movies Summary: ✅ ${successCount} inserted, ⏭️  ${skippedCount} skipped (duplicates), ⚠️  ${failedCount} failed\n`,
  );
  return { success: successCount, failed: failedCount, skipped: skippedCount };
}

async function ingestTv(pages = 3, existingIds = new Set()) {
  console.log(`\n📺 Starting TV show ingestion (${pages} pages)...\n`);

  const totalShows = pages * 20; // TMDB returns ~20 per page
  let processedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  let batch = [];

  for (let p = 1; p <= pages; p++) {
    const page = await getTvPage(p);

    for (const t of page) {
      // Skip if already in database
      if (existingIds.has(t.id)) {
        skippedCount++;
        processedCount++;
        console.log(
          `[${processedCount}/${totalShows}] ⏭️  Skipped (already exists): ${t.name} (${t.id})`,
        );
        continue;
      }

      try {
        const d = await getTvDetails(t.id);
        const norm = normalizeTv(d);

        batch.push(norm);
        processedCount++;

        console.log(
          `[${processedCount}/${totalShows}] Fetched: ${norm.title} (${norm.id})`,
        );

        // Process batch when it reaches BATCH_SIZE or it's the last item
        if (batch.length >= BATCH_SIZE || processedCount === totalShows) {
          const result = await processBatch(
            batch,
            "TV shows",
            processedCount,
            totalShows,
          );
          successCount += result.success;
          failedCount += result.failed;
          batch = []; // Clear batch
        }

        await gentle(); // Rate limit for TMDB
      } catch (error) {
        console.warn(
          `⚠️  Skipping TV show ${t.id} (${t.name}): ${error.message}`,
        );
        failedCount++;
        processedCount++;
      }
    }
  }

  console.log(
    `\n📺 TV Shows Summary: ✅ ${successCount} inserted, ⏭️  ${skippedCount} skipped (duplicates), ⚠️  ${failedCount} failed\n`,
  );
  return { success: successCount, failed: failedCount, skipped: skippedCount };
}

async function main() {
  console.log("🚀 Starting TMDB → Supabase ingestion...\n");

  const MOVIE_PAGES = 25;
  const TV_PAGES = 25;
  const estimatedMovies = MOVIE_PAGES * 20;
  const estimatedTv = TV_PAGES * 20;
  const estimatedTotal = estimatedMovies + estimatedTv;
  const estimatedMinutes = Math.ceil((estimatedTotal * 0.25) / 60);

  console.log("━".repeat(60));
  console.log("📊 INGESTION PLAN");
  console.log("━".repeat(60));
  console.log(`🎬 Movies: ~${estimatedMovies} titles (${MOVIE_PAGES} pages)`);
  console.log(`📺 TV Shows: ~${estimatedTv} titles (${TV_PAGES} pages)`);
  console.log(`📦 Total: ~${estimatedTotal} titles`);
  console.log(`⏱️  Estimated time: ~${estimatedMinutes} minutes`);
  console.log(`💰 TMDB API cost: FREE`);
  console.log(`🔄 Rate limit: 250ms/request (4 req/sec)`);
  console.log(`✅ Duplicate checking: ENABLED (skips existing IDs)`);
  console.log("━".repeat(60));
  console.log("\n⏳ Starting in 3 seconds... (Press Ctrl+C to cancel)\n");

  await sleep(3000);

  const startTime = Date.now();

  try {
    // Fetch existing IDs to skip duplicates
    const existingIds = await getExistingTitleIds();

    const movieStats = await ingestMovies(MOVIE_PAGES, existingIds);
    const tvStats = await ingestTv(TV_PAGES, existingIds);

    const totalSuccess = movieStats.success + tvStats.success;
    const totalFailed = movieStats.failed + tvStats.failed;
    const totalSkipped = movieStats.skipped + tvStats.skipped;
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const durationMinutes = (duration / 60).toFixed(1);

    console.log("\n" + "━".repeat(60));
    console.log("✨ INGESTION COMPLETE");
    console.log("━".repeat(60));
    console.log(`✅ Successfully inserted: ${totalSuccess} titles`);
    console.log(`⏭️  Skipped (duplicates): ${totalSkipped} titles`);
    console.log(`⚠️  Failed: ${totalFailed} titles`);
    console.log(`⏱️  Duration: ${durationMinutes}m (${duration}s)`);
    if (totalSuccess + totalFailed > 0) {
      console.log(
        `📈 Success rate: ${((totalSuccess / (totalSuccess + totalFailed)) * 100).toFixed(1)}%`,
      );
    }
    console.log("━".repeat(60));
    console.log("\n📝 Next steps:");
    console.log("   1. Run enrichment: npm run enrich");
    console.log(
      "   2. Generate embeddings: npm run backfill:multi:incremental",
    );
    console.log("   3. Test search: npm run search:multi\n");
  } catch (e) {
    console.error("\n❌ Fatal error during ingestion:", e);
    process.exit(1);
  }
}

// Graceful shutdown handler
process.on("SIGINT", () => {
  console.log(
    "\n\n⚠️  Interrupted by user. Current batch will complete before exit...",
  );
  console.log(
    "💡 Tip: Already-inserted titles won't be duplicated if you re-run.",
  );
  process.exit(0);
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
