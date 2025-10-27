// CLI script to run title enrichment
// Usage: node run-enrichment.js [--limit N] [--id ID] [--test]
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import { enrichTitleRow, enrichTitles } from "./enrich-titles.js";

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: null,
    id: null,
    test: false,
    sample: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--id" && args[i + 1]) {
      options.id = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--sample" && args[i + 1]) {
      options.sample = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--test") {
      options.test = true;
    }
  }

  return options;
}

/**
 * Fetch titles from Supabase that need enrichment
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Array of title rows
 */
async function fetchTitles(options) {
  let query = supabase
    .from("titles")
    .select(
      "id, kind, title, original_title, overview, release_date, runtime_minutes, genres, payload, profile_string, slots",
    );

  // Filter by ID if specified
  if (options.id) {
    query = query.eq("id", options.id);
  } else if (options.sample) {
    // Sample mode: get random existing titles (regardless of enrichment status)
    // This is useful for testing the new LLM-based extraction on existing data
    query = query.limit(options.sample);
  } else {
    // Default: only fetch titles without profile_string (need enrichment)
    query = query.is("profile_string", null);
  }

  // Apply limit (if not using sample)
  if (options.limit && !options.sample) {
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
 * Wikipedia title resolver for movies/TV shows
 * Attempts to handle common disambiguation patterns
 * @param {Object} row - Title row
 * @returns {string} - Wikipedia title to search for
 */
function resolveWikiTitle(row) {
  const title = row.title;
  const year = row.release_date ? row.release_date.slice(0, 4) : null;
  const kind = row.kind; // 'movie' or 'tv'

  // For TV shows, don't add disambiguation - usually the base title works
  if (kind === "tv") {
    return title;
  }

  // For movies, try "Title (YYYY film)" for recent movies
  // But only if year is available and movie is post-2000 (avoids classic film confusion)
  if (kind === "movie" && year && Number(year) >= 2000) {
    return `${title} (${year} film)`;
  }

  // Fallback to just the title for older films or when year unavailable
  return title;
}

/**
 * Main enrichment runner
 */
async function main() {
  const options = parseArgs();

  console.log("🚀 Starting Wikipedia Enrichment");
  console.log("━".repeat(60));

  if (options.test) {
    console.log("🧪 TEST MODE: Will process 1 title only");
    options.limit = 1;
  }

  // Set default limit to avoid timeouts when processing large datasets
  if (!options.id && !options.sample && !options.limit) {
    options.limit = 50; // Default batch size
    console.log(`📊 Batch mode: ${options.limit} titles (default batch size)`);
    console.log(
      `   Use --limit N to process more, or run multiple times to process all`,
    );
  } else if (options.id) {
    console.log(`🎯 Single title mode: ID ${options.id}`);
  } else if (options.sample) {
    console.log(`🎲 Sample mode: ${options.sample} random existing titles`);
  } else if (options.limit) {
    console.log(`📊 Batch mode: ${options.limit} titles`);
  }

  console.log("━".repeat(60));

  const startTime = Date.now();

  try {
    // Fetch titles to enrich
    console.log("\n📥 Fetching titles from Supabase...");
    const titles = await fetchTitles(options);

    if (titles.length === 0) {
      console.log("✨ No titles need enrichment!");
      return;
    }

    console.log(`✅ Found ${titles.length} title(s) to enrich\n`);

    // Run enrichment
    const results = await enrichTitles(titles, {
      delayMs: options.test ? 500 : 1500, // Faster in test mode
    });

    // Print summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("\n" + "━".repeat(60));
    console.log("✨ ENRICHMENT COMPLETE");
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
      results.errors.forEach((err) => {
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
