// Re-enrichment script for titles with missing vibes/tone
// Specifically targets the 103 titles identified in the data quality audit
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import { enrichTitles } from "./enrich-titles.js";

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: null,
    id: null,
    kind: null, // 'movie' or 'tv'
    dryRun: false,
    force: false, // Re-enrich even if vibes/tone already exist
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--id" && args[i + 1]) {
      options.id = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--kind" && args[i + 1]) {
      options.kind = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      options.dryRun = true;
    } else if (args[i] === "--force") {
      options.force = true;
    }
  }

  return options;
}

/**
 * Fetch titles that need re-enrichment (missing vibes or tone)
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Array of title rows
 */
async function fetchTitlesToReEnrich(options) {
  let query = supabase
    .from("titles")
    .select(
      "id, kind, title, original_title, overview, release_date, runtime_minutes, genres, keywords, tagline, cast, director, writers, profile_string, vibes, tone, pacing, themes, slots",
    );

  // Filter by ID if specified
  if (options.id) {
    query = query.eq("id", options.id);
  } else if (options.force) {
    // Force mode: re-enrich ALL titles (useful for testing new pipeline)
    console.log("🔄 Force mode: Will re-enrich ALL titles");
  } else {
    // Default: only fetch titles missing vibes OR tone
    query = query.or("vibes.is.null,tone.is.null");
  }

  // Filter by kind if specified
  if (options.kind) {
    query = query.eq("kind", options.kind);
  }

  // Apply limit
  if (options.limit) {
    query = query.limit(options.limit);
  }

  // Order by ID
  query = query.order("id", { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch titles: ${error.message}`);
  }

  return data || [];
}

/**
 * Main re-enrichment runner
 */
async function main() {
  const options = parseArgs();

  console.log("🔄 Starting Re-Enrichment for Missing Data");
  console.log("━".repeat(60));

  if (options.dryRun) {
    console.log("🧪 DRY RUN MODE: Will fetch titles but NOT enrich them");
  }

  if (options.id) {
    console.log(`🎯 Single title mode: ID ${options.id}`);
  } else if (options.force) {
    console.log(`⚡ Force mode: Re-enriching ALL titles`);
  } else {
    console.log(`🔍 Targeting titles with missing vibes OR tone`);
  }

  if (options.kind) {
    console.log(`📺 Filtering by kind: ${options.kind}`);
  }

  if (options.limit) {
    console.log(`📊 Limit: ${options.limit} titles`);
  }

  console.log("━".repeat(60));

  const startTime = Date.now();

  try {
    // Fetch titles to re-enrich
    console.log("\n📥 Fetching titles from Supabase...");
    const titles = await fetchTitlesToReEnrich(options);

    if (titles.length === 0) {
      console.log("✨ No titles need re-enrichment!");
      return;
    }

    console.log(`✅ Found ${titles.length} title(s) to re-enrich\n`);

    // Show sample of titles to be enriched
    console.log("📋 Sample of titles to be enriched:");
    titles.slice(0, 10).forEach((title, idx) => {
      const hasVibes = title.vibes && title.vibes.length > 0;
      const hasTone = title.tone && title.tone.trim().length > 0;
      const status = !hasVibes && !hasTone ? "❌ No vibes/tone" :
                     !hasVibes ? "⚠️ No vibes" :
                     !hasTone ? "⚠️ No tone" : "✅ Has data";
      console.log(`   ${idx + 1}. ${title.title} (${title.kind}, ${title.id}) - ${status}`);
    });
    if (titles.length > 10) {
      console.log(`   ... and ${titles.length - 10} more`);
    }

    if (options.dryRun) {
      console.log("\n🧪 DRY RUN COMPLETE - No enrichment performed");
      return;
    }

    // Confirm before proceeding
    console.log(`\n⚠️  About to re-enrich ${titles.length} titles`);
    console.log("   This will overwrite existing metadata (if --force is used)");
    console.log("   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n");

    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Run enrichment
    const results = await enrichTitles(titles, {
      delayMs: 1500, // Standard rate limiting
    });

    // Print summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("\n" + "━".repeat(60));
    console.log("✨ RE-ENRICHMENT COMPLETE");
    console.log("━".repeat(60));
    console.log(
      `✅ Successfully enriched: ${results.success}/${results.total}`,
    );
    console.log(`⚠️  Failed: ${results.failed}/${results.total}`);
    console.log(`⏱️  Duration: ${duration}s`);

    // Print method breakdown
    if (results.methods) {
      console.log("\n📊 Enrichment Methods Used:");
      console.log(
        `   📖 Wikipedia: ${results.methods.wikipedia || 0} (${((results.methods.wikipedia / results.total) * 100).toFixed(1)}%)`,
      );
      console.log(
        `   📝 TMDB Overview: ${results.methods.tmdb_overview || 0} (${((results.methods.tmdb_overview / results.total) * 100).toFixed(1)}%)`,
      );
      console.log(
        `   🔍 TMDB Inference: ${results.methods.tmdb_inference || 0} (${((results.methods.tmdb_inference / results.total) * 100).toFixed(1)}%)`,
      );
      console.log(
        `   🎲 Defaults: ${results.methods.defaults || 0} (${((results.methods.defaults / results.total) * 100).toFixed(1)}%)`,
      );
      if (results.methods.error > 0) {
        console.log(
          `   ❌ Errors: ${results.methods.error} (${((results.methods.error / results.total) * 100).toFixed(1)}%)`,
        );
      }
    }

    if (results.errors.length > 0) {
      console.log("\n❌ Errors:");
      results.errors.slice(0, 10).forEach((err) => {
        console.log(`   - ${err.title} (ID: ${err.id}): ${err.error}`);
      });
      if (results.errors.length > 10) {
        console.log(`   ... and ${results.errors.length - 10} more errors`);
      }
    }

    // Success rate analysis
    const successRate = (results.success / results.total) * 100;
    console.log("\n📈 Success Rate Analysis:");
    console.log(`   Overall: ${successRate.toFixed(1)}%`);

    if (successRate >= 95) {
      console.log("   ✅ Excellent! Almost all titles enriched successfully");
    } else if (successRate >= 80) {
      console.log("   ✅ Good! Most titles enriched successfully");
    } else if (successRate >= 60) {
      console.log("   ⚠️  Fair. Consider investigating common failure patterns");
    } else {
      console.log("   ❌ Poor. Many titles failed - check errors above");
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
