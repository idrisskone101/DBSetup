import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import { generateEmbeddings } from "./embeddings.js";

/**
 * Test semantic search by finding similar titles based on a text query
 * @param {string} query - Text query to search for
 * @param {number} limit - Number of results to return
 */
async function semanticSearch(query, limit = 5) {
  console.log(`\n🔍 Searching for: "${query}"\n`);

  // Step 1: Generate embedding for the search query
  console.log("📊 Generating embedding for search query...");
  const queryObj = {
    title: query,
    overview: query,
    kind: "search_query",
  };

  const [queryEmbedding] = await generateEmbeddings([queryObj]);

  if (!queryEmbedding) {
    console.error("❌ Failed to generate query embedding");
    return;
  }

  console.log("✅ Query embedding generated\n");

  // Step 2: Search for similar titles using the match_titles function
  console.log(`🎬 Searching for ${limit} most similar titles...\n`);

  const { data, error } = await supabase.rpc("match_titles", {
    query_embedding: queryEmbedding,
    match_threshold: 0.0, // Accept all results (we'll limit by count)
    match_count: limit,
  });

  if (error) {
    console.error("❌ Search error:", error.message);
    return;
  }

  // Step 3: Display results
  if (!data || data.length === 0) {
    console.log("ℹ️  No results found");
    return;
  }

  console.log("━".repeat(80));
  console.log("🎯 SEARCH RESULTS");
  console.log("━".repeat(80) + "\n");

  data.forEach((result, index) => {
    console.log(`${index + 1}. ${result.title} (${result.kind})`);
    console.log(`   Similarity: ${(result.similarity * 100).toFixed(2)}%`);
    if (result.genres && result.genres.length > 0) {
      console.log(`   Genres: ${result.genres.join(", ")}`);
    }
    if (result.vote_average) {
      console.log(`   Rating: ${result.vote_average}/10`);
    }
    if (result.overview) {
      const shortOverview =
        result.overview.length > 100
          ? result.overview.substring(0, 100) + "..."
          : result.overview;
      console.log(`   Overview: ${shortOverview}`);
    }
    console.log();
  });

  console.log("━".repeat(80) + "\n");
}

/**
 * Run multiple example searches to demonstrate semantic search
 */
async function runExamples() {
  console.log("🚀 SEMANTIC SEARCH DEMO\n");
  console.log(
    "This demonstrates how vector embeddings enable meaning-based search.\n",
  );

  // Example searches
  const examples = [
    "action movies with fighting and explosions",
    "romantic comedy about finding love",
    "science fiction space adventure",
    "horror movie with demons",
    "superhero saving the world",
  ];

  for (const query of examples) {
    await semanticSearch(query, 3);
    console.log("\n" + "─".repeat(80) + "\n");
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit
  }
}

// Main execution
const query = process.argv[2];

if (query) {
  // Single search with custom query
  const limit = parseInt(process.argv[3]) || 5;
  semanticSearch(query, limit).catch(console.error);
} else {
  // Run demo examples
  runExamples().catch(console.error);
}
