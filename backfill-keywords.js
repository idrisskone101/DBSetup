// Backfill keywords for titles missing them
// Uses existing TMDB infrastructure and Supabase setup
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import { getMovieDetails, getTvDetails } from "./tmdb.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backfill keywords for a single title
 */
async function backfillKeywords(row) {
  console.log(`\n📚 ${row.title} (ID: ${row.id}, Kind: ${row.kind})`);

  try {
    // Fetch TMDB details
    const detail =
      row.kind === "movie"
        ? await getMovieDetails(row.id)
        : await getTvDetails(row.id);

    // Extract keywords
    let keywords = [];
    if (row.kind === "movie") {
      keywords = detail.keywords?.keywords?.map((k) => k.name) || [];
    } else {
      keywords = detail.keywords?.results?.map((k) => k.name) || [];
    }

    if (keywords.length === 0) {
      console.log(`  ⚠️  No keywords found on TMDB`);
      return { success: true, id: row.id, keywords_count: 0, skipped: true };
    }

    console.log(`  ✅ Found ${keywords.length} keywords: ${keywords.slice(0, 5).join(", ")}${keywords.length > 5 ? "..." : ""}`);

    // Update Supabase
    const { error } = await supabase
      .from("titles")
      .update({
        keywords: keywords,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (error) throw new Error(`Supabase error: ${error.message}`);

    console.log(`  💾 Database updated`);

    return {
      success: true,
      id: row.id,
      title: row.title,
      keywords_count: keywords.length,
    };
  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return {
      success: false,
      id: row.id,
      title: row.title,
      error: error.message,
    };
  }
}

/**
 * Get titles missing keywords, ordered by popularity
 */
async function getTitlesMissingKeywords(limit = 100) {
  const { data, error } = await supabase
    .from("titles")
    .select("id, kind, title, popularity")
    .is("keywords", null)
    .order("popularity", { ascending: false, nullsLast: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to query titles: ${error.message}`);
  }

  return data || [];
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args[0]) || 50;
  const delayMs = 500; // TMDB rate limit

  console.log(`\n🔑 KEYWORD BACKFILL TOOL`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(`Fetching up to ${limit} titles missing keywords...\n`);

  const rows = await getTitlesMissingKeywords(limit);

  if (rows.length === 0) {
    console.log(`✨ No titles missing keywords!`);
    process.exit(0);
  }

  console.log(`Found ${rows.length} titles to process\n`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const startTime = Date.now();
  const results = {
    total: rows.length,
    success: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < rows.length; i++) {
    console.log(`[${i + 1}/${rows.length}]`);
    const result = await backfillKeywords(rows[i]);

    if (result.success) {
      if (result.skipped) {
        results.skipped++;
      } else {
        results.success++;
      }
    } else {
      results.failed++;
      results.errors.push(result);
    }

    if (i < rows.length - 1) {
      await sleep(delayMs);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✨ BACKFILL COMPLETE`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Successfully backfilled: ${results.success}`);
  console.log(`⚠️  No keywords found: ${results.skipped}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`⏱️  Duration: ${duration}s`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (results.errors.length > 0) {
    console.log(`\n❌ Errors:`);
    results.errors.forEach((err) => {
      console.log(`   - ${err.title} (${err.id}): ${err.error}`);
    });
  }

  console.log(
    `\n⚠️  NEXT STEP: Regenerate metadata_embedding for updated titles`,
  );
  console.log(
    `   Run: node generate-multi-embeddings-backfill.js (or similar)\n`,
  );
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
