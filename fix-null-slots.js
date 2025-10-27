// Re-enrichment script for titles with null slots
// Targets specific IDs that have incomplete slot data
import "dotenv/config.js";
import { supabase } from "./enrich-titles.js";
import { enrichTitleRow } from "./enrich-titles.js";

// IDs of titles with null or incomplete slots (from database query)
const FAILED_IDS = [
  18165, 30623, 34860, 37680, 46034, 57911, 71790, 101253,
  124364, 199332, 205715, 210865, 221079, 228305, 246027, 265167,
  1275585, 1280450, 1357886, 1375402, 1429750, 1552819
];

/**
 * Fetch titles by IDs
 */
async function fetchTitlesByIds(ids) {
  const { data, error } = await supabase
    .from("titles")
    .select(
      "id, kind, title, original_title, overview, release_date, runtime_minutes, genres, payload, profile_string, slots"
    )
    .in("id", ids)
    .order("id", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch titles: ${error.message}`);
  }

  return data || [];
}

/**
 * Main re-enrichment runner
 */
async function main() {
  console.log("🔧 Re-enriching titles with null/incomplete slots");
  console.log("━".repeat(60));
  console.log(`📊 Targeting ${FAILED_IDS.length} titles\n`);

  const startTime = Date.now();

  try {
    // Fetch titles to re-enrich
    console.log("📥 Fetching titles from Supabase...");
    const titles = await fetchTitlesByIds(FAILED_IDS);

    if (titles.length === 0) {
      console.log("✨ No titles found!");
      return;
    }

    console.log(`✅ Found ${titles.length} title(s) to re-enrich\n`);

    // Re-enrich each title
    let success = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < titles.length; i++) {
      const title = titles[i];
      console.log(`\n[${i + 1}/${titles.length}] Processing: ${title.title} (ID: ${title.id})`);

      const result = await enrichTitleRow(title);

      if (result.success) {
        success++;
        console.log(`  ✅ Successfully enriched!`);
      } else {
        failed++;
        errors.push({ id: result.id, title: result.title, error: result.error });
        console.log(`  ❌ Failed: ${result.error}`);
      }

      // Rate limiting - be respectful to APIs
      if (i < titles.length - 1) {
        const delayMs = 1500;
        console.log(`  ⏸️  Waiting ${delayMs}ms before next request...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Print summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("\n" + "━".repeat(60));
    console.log("✨ RE-ENRICHMENT COMPLETE");
    console.log("━".repeat(60));
    console.log(`✅ Successfully enriched: ${success}/${titles.length}`);
    console.log(`⚠️  Failed: ${failed}/${titles.length}`);
    console.log(`⏱️  Duration: ${duration}s`);

    if (errors.length > 0) {
      console.log("\n❌ Errors:");
      errors.forEach((err) => {
        console.log(`   - ${err.title} (ID: ${err.id}): ${err.error}`);
      });
    }

    console.log("━".repeat(60));
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n⚠️  Interrupted by user. Exiting...");
  process.exit(0);
});

main().catch((error) => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
});
