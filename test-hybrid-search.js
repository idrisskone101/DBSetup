// Test script for hybrid BM25 + vector search
// Combines semantic similarity with exact keyword matching and popularity boosting

import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import OpenAI from "openai";
import { expandQuerySafe } from "./query-expansion.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate query embeddings (768 dims)
 */
async function generateQueryEmbeddings(query, expandedQuery = null) {
  const texts = expandedQuery ? {
    vibe: `Vibes: ${expandedQuery.vibe}`,
    content: `Story: ${expandedQuery.content}`,
    metadata: `Genres: ${expandedQuery.metadata}`,
  } : {
    vibe: `Vibes: ${query}`,
    content: `Story: ${query}`,
    metadata: `Genres: ${query}`,
  };

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: [texts.content, texts.vibe, texts.metadata],
    dimensions: 768,
    encoding_format: "float",
  });

  return {
    content: response.data[0].embedding,
    vibe: response.data[1].embedding,
    metadata: response.data[2].embedding,
  };
}

/**
 * Perform hybrid search
 */
async function hybridSearch(query, options = {}) {
  const {
    weightContent = 0.40,
    weightVibe = 0.35,
    weightMetadata = 0.25,
    weightKeyword = 0.15,
    weightPopularity = 0.10,
    matchThreshold = 0.25,
    matchCount = 10,
    useExpansion = true,
    verbose = true,
  } = options;

  if (verbose) {
    console.log("\n" + "=".repeat(80));
    console.log("🔍 HYBRID SEARCH (Vector + BM25 + Popularity)");
    console.log("=".repeat(80));
    console.log(`Query: "${query}"\n`);
  }

  // Query expansion
  let expandedQuery = null;
  if (useExpansion) {
    if (verbose) console.log("🔄 Expanding query...");
    expandedQuery = await expandQuerySafe(query, { verbose: false });
    if (verbose && expandedQuery.vibe !== query) {
      console.log(`✅ Expanded to: "${expandedQuery.content.substring(0, 60)}..."\n`);
    }
  }

  // Generate embeddings
  if (verbose) console.log("🤖 Generating embeddings (768 dims)...");
  const embeddings = await generateQueryEmbeddings(query, expandedQuery);
  if (verbose) console.log("✅ Embeddings generated\n");

  // Call hybrid search function
  if (verbose) {
    console.log("🎬 Searching database...");
    console.log(`   Weights: semantic=${((1 - weightKeyword - weightPopularity) * 100).toFixed(0)}% (content=${(weightContent * 100).toFixed(0)}%, vibe=${(weightVibe * 100).toFixed(0)}%, metadata=${(weightMetadata * 100).toFixed(0)}%)`);
    console.log(`           keyword=${(weightKeyword * 100).toFixed(0)}%, popularity=${(weightPopularity * 100).toFixed(0)}%`);
    console.log(`   Threshold: ${matchThreshold} | Max results: ${matchCount}\n`);
  }

  const { data, error } = await supabase.rpc("hybrid_search_titles", {
    query_text: query,
    query_content_embedding: embeddings.content,
    query_vibe_embedding: embeddings.vibe,
    query_metadata_embedding: embeddings.metadata,
    weight_content: weightContent,
    weight_vibe: weightVibe,
    weight_metadata: weightMetadata,
    weight_keyword: weightKeyword,
    weight_popularity: weightPopularity,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error) {
    console.error("❌ Search error:", error.message);
    throw error;
  }

  return data || [];
}

/**
 * Display results
 */
function displayResults(results, query) {
  if (!results || results.length === 0) {
    console.log("ℹ️  No results found\n");
    return;
  }

  console.log("━".repeat(80));
  console.log(`📊 Results (${results.length} matches)`);
  console.log("━".repeat(80) + "\n");

  results.forEach((result, i) => {
    const year = result.release_date ? new Date(result.release_date).getFullYear() : "N/A";

    console.log(`${i + 1}. ⭐ ${result.title} (${year}) [${result.kind}]`);
    console.log(`   Combined Score: ${(result.combined_score * 100).toFixed(1)}%`);
    console.log(`   Breakdown:`);
    console.log(`     • Semantic: content=${(result.content_score * 100).toFixed(1)}%, vibe=${(result.vibe_score * 100).toFixed(1)}%, metadata=${(result.metadata_score * 100).toFixed(1)}%`);
    console.log(`     • Keyword:  ${(result.keyword_score * 100).toFixed(1)}% ${result.keyword_score > 0.3 ? "🔥" : ""}`);
    console.log(`     • Quality:  ${(result.popularity_score * 100).toFixed(1)}% (rating: ${result.vote_average || "N/A"}/10)`);
    console.log(`     • Strongest: ${result.strongest_signal}`);

    if (result.director) console.log(`   Director: ${result.director}`);
    if (result.genres?.length) console.log(`   Genres: ${result.genres.join(", ")}`);
    if (result.vibes?.length) console.log(`   Vibes: ${result.vibes.join(", ")}`);

    console.log();
  });

  console.log("━".repeat(80));
  console.log(`[Legend: 🔥 = strong keyword match | Strongest = dominant signal type]`);
  console.log("━".repeat(80) + "\n");
}

/**
 * Compare hybrid vs vector-only search
 */
async function compareSearchModes(query) {
  console.log("\n" + "=".repeat(80));
  console.log("⚖️  COMPARISON: Hybrid vs Vector-Only");
  console.log("=".repeat(80) + "\n");

  // Hybrid search
  console.log("🔵 Hybrid Search (Vector + BM25 + Popularity):");
  const hybridResults = await hybridSearch(query, {
    verbose: false,
    matchCount: 5,
  });
  displayResults(hybridResults.slice(0, 5), query);

  // Vector-only search (simulate by setting keyword weight to 0)
  console.log("\n🟢 Vector-Only Search:");
  const vectorResults = await hybridSearch(query, {
    weightKeyword: 0,
    weightPopularity: 0,
    verbose: false,
    matchCount: 5,
  });
  displayResults(vectorResults.slice(0, 5), query);
}

/**
 * Test suite
 */
async function runTests() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 HYBRID SEARCH TEST SUITE");
  console.log("=".repeat(80) + "\n");

  const testCases = [
    {
      query: "Christopher Nolan",
      description: "Director name (should prioritize keyword match)",
    },
    {
      query: "dark comedy thriller",
      description: "Hybrid query (vibes + genres)",
    },
    {
      query: "cozy family movie",
      description: "Vibe-focused query with quality boost",
    },
    {
      query: "inception",
      description: "Title exact match test",
    },
  ];

  for (const testCase of testCases) {
    console.log(`📝 Test: ${testCase.description}`);
    console.log(`   Query: "${testCase.query}"\n`);

    const results = await hybridSearch(testCase.query, {
      verbose: false,
      matchCount: 3,
    });

    displayResults(results, testCase.query);

    console.log("\n" + "─".repeat(80) + "\n");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log("✅ Test suite complete!\n");
}

/**
 * CLI
 */
async function main() {
  const args = process.argv.slice(2);
  const query = args.find((a) => !a.startsWith("--"));

  const flags = {
    test: args.includes("--test"),
    compare: args.includes("--compare"),
    help: args.includes("--help") || args.includes("-h"),
    noExpansion: args.includes("--no-expansion"),
  };

  if (flags.help || !query && !flags.test) {
    console.log(`
Hybrid Search Test Tool

Usage:
  node test-hybrid-search.js [query] [options]

Options:
  --test            Run test suite
  --compare         Compare hybrid vs vector-only results
  --no-expansion    Disable query expansion
  -h, --help        Show this help

Examples:
  node test-hybrid-search.js "Christopher Nolan"
  node test-hybrid-search.js "dark comedy" --compare
  node test-hybrid-search.js --test
`);
    return;
  }

  if (flags.test) {
    await runTests();
    return;
  }

  if (flags.compare) {
    await compareSearchModes(query);
    return;
  }

  // Standard search
  const results = await hybridSearch(query, {
    useExpansion: !flags.noExpansion,
  });
  displayResults(results, query);
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
