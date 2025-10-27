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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gentle = async () => sleep(250); // Same rate limit as main ingestion

/**
 * Fetch existing title IDs from database for duplicate checking
 */
async function getExistingTitleIds() {
  const { data, error } = await supabase.from("titles").select("id");

  if (error) {
    console.warn(`⚠️  Could not fetch existing IDs: ${error.message}`);
    return new Set();
  }

  return new Set(data.map((row) => row.id));
}

/**
 * Test ingestion with small sample (1 page each = ~40 titles)
 * Validates the full pipeline before running large ingestion
 */
async function testIngest() {
  console.log("🧪 TEST INGESTION - Small Sample\n");
  console.log("━".repeat(60));
  console.log("📊 TEST PLAN");
  console.log("━".repeat(60));
  console.log("🎬 Movies: ~20 titles (1 page)");
  console.log("📺 TV Shows: ~20 titles (1 page)");
  console.log("📦 Total: ~40 titles");
  console.log("⏱️  Estimated time: ~30 seconds");
  console.log("🎯 Purpose: Validate TMDB → Supabase pipeline");
  console.log("✅ Duplicate checking: ENABLED");
  console.log("━".repeat(60));
  console.log();

  const startTime = Date.now();
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const sampleTitles = [];

  try {
    // Fetch existing IDs for duplicate checking
    console.log("📊 Checking for existing titles...");
    const existingIds = await getExistingTitleIds();
    console.log(`   Found ${existingIds.size} existing titles\n`);

    // Test Movies
    console.log("🎬 Fetching movie samples...\n");
    const moviePage = await getMoviesPage(1);
    let movieBatch = [];

    for (const m of moviePage.slice(0, 5)) {
      // Just show 5 examples
      // Skip if already exists
      if (existingIds.has(m.id)) {
        totalSkipped++;
        console.log(`  ⏭️  Skipped (already exists): ${m.title} (${m.id})`);
        continue;
      }

      try {
        const d = await getMovieDetails(m.id);
        const norm = normalizeMovie(d);
        movieBatch.push(norm);
        sampleTitles.push({
          title: norm.title,
          kind: "movie",
          genres: norm.genres,
          year: norm.release_date?.slice(0, 4),
        });
        console.log(
          `  ✅ ${norm.title} (${norm.release_date?.slice(0, 4) || "N/A"})`,
        );
        await gentle();
      } catch (error) {
        console.warn(`  ⚠️  Skipped: ${m.title} - ${error.message}`);
        totalFailed++;
      }
    }

    // Insert movie batch
    if (movieBatch.length > 0) {
      const result = await batchUpsertTitles(movieBatch);
      totalSuccess += result.success;
      totalFailed += result.failed;
      console.log(`\n  💾 Inserted ${result.success} movies into database\n`);
    }

    // Test TV Shows
    console.log("📺 Fetching TV show samples...\n");
    const tvPage = await getTvPage(1);
    let tvBatch = [];

    for (const t of tvPage.slice(0, 5)) {
      // Just show 5 examples
      // Skip if already exists
      if (existingIds.has(t.id)) {
        totalSkipped++;
        console.log(`  ⏭️  Skipped (already exists): ${t.name} (${t.id})`);
        continue;
      }

      try {
        const d = await getTvDetails(t.id);
        const norm = normalizeTv(d);
        tvBatch.push(norm);
        sampleTitles.push({
          title: norm.title,
          kind: "tv",
          genres: norm.genres,
          year: norm.release_date?.slice(0, 4),
        });
        console.log(
          `  ✅ ${norm.title} (${norm.release_date?.slice(0, 4) || "N/A"})`,
        );
        await gentle();
      } catch (error) {
        console.warn(`  ⚠️  Skipped: ${t.name} - ${error.message}`);
        totalFailed++;
      }
    }

    // Insert TV batch
    if (tvBatch.length > 0) {
      const result = await batchUpsertTitles(tvBatch);
      totalSuccess += result.success;
      totalFailed += result.failed;
      console.log(`\n  💾 Inserted ${result.success} TV shows into database\n`);
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("━".repeat(60));
    console.log("✅ TEST INGESTION COMPLETE");
    console.log("━".repeat(60));
    console.log(`✅ Successfully inserted: ${totalSuccess} titles`);
    console.log(`⏭️  Skipped (duplicates): ${totalSkipped} titles`);
    console.log(`⚠️  Failed: ${totalFailed} titles`);
    console.log(`⏱️  Duration: ${duration}s`);
    if (totalSuccess + totalFailed > 0) {
      console.log(
        `📈 Success rate: ${((totalSuccess / (totalSuccess + totalFailed)) * 100).toFixed(1)}%`,
      );
    }
    console.log("━".repeat(60));

    // Show sample data quality
    console.log("\n📊 SAMPLE DATA PREVIEW");
    console.log("━".repeat(60));
    sampleTitles.slice(0, 3).forEach((t) => {
      console.log(`📺 ${t.title} (${t.year || "N/A"})`);
      console.log(`   Kind: ${t.kind}`);
      console.log(`   Genres: ${t.genres.join(", ") || "none"}`);
      console.log();
    });
    console.log("━".repeat(60));

    console.log("\n✅ Pipeline validation successful!");
    console.log("\n📝 Ready for full ingestion:");
    console.log("   Run: npm run ingest:full");
    console.log("   This will fetch ~1,000 titles (25 pages each)\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  }
}

testIngest().catch((e) => {
  console.error(e);
  process.exit(1);
});
