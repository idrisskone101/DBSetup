#!/usr/bin/env node
// Validation script to test semantic search quality after re-enrichment
// Tests if compound vibes like "dark comedy" return contextually correct results
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const match = databaseUrl.match(/db\.([^.]+)\.supabase\.co/);
const projectRef = match[1];
const supabaseUrl = `https://${projectRef}.supabase.co`;

const supabase = createClient(
  supabaseUrl,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate embedding for a query
 */
async function generateQueryEmbedding(query) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  return response.data[0].embedding;
}

/**
 * Search titles by vibe embedding
 */
async function searchByVibe(query, limit = 10) {
  const embedding = await generateQueryEmbedding(query);

  const { data, error } = await supabase.rpc("match_titles_vibe", {
    query_embedding: embedding,
    match_threshold: 0.0,
    match_count: limit,
  });

  if (error) {
    console.error("Search error:", error);
    return [];
  }

  return data;
}

/**
 * Test cases for validation
 */
const TEST_CASES = [
  {
    query: "dark comedy",
    expectation: "Should return comedies with dark humor, NOT pure horror films",
    validateFn: (results) => {
      const horrorOnly = results.filter(
        (r) =>
          r.genres?.includes("horror") &&
          !r.genres?.includes("comedy") &&
          !r.vibes?.some((v) => v.toLowerCase().includes("comedy"))
      );
      return {
        pass: horrorOnly.length === 0,
        details: `Found ${horrorOnly.length} pure horror films in top 10 (should be 0)`,
      };
    },
  },
  {
    query: "psychological thriller",
    expectation: "Should return thrillers with psychological elements, compound vibes preferred",
    validateFn: (results) => {
      const hasCompoundVibe = results.filter((r) =>
        r.vibes?.some((v) => {
          const vLower = v.toLowerCase();
          return (vLower.includes("psychological") && vLower.includes("thriller")) ||
                 vLower === "psychological thriller";
        })
      );
      return {
        pass: hasCompoundVibe.length >= 5,
        details: `${hasCompoundVibe.length}/10 results have compound 'psychological thriller' vibe (need ≥5)`,
      };
    },
  },
  {
    query: "whimsical fantasy",
    expectation: "Should return fantasy with whimsical tone, not dark fantasy",
    validateFn: (results) => {
      const darkFantasy = results.filter((r) =>
        r.vibes?.some((v) => {
          const vLower = v.toLowerCase();
          return vLower.includes("dark") && vLower.includes("fantasy");
        })
      );
      return {
        pass: darkFantasy.length <= 2,
        details: `Found ${darkFantasy.length} dark fantasy films (should be ≤2)`,
      };
    },
  },
  {
    query: "gritty crime noir",
    expectation: "Should return noir crime films with gritty tone",
    validateFn: (results) => {
      const hasCrimeGenre = results.filter((r) => r.genres?.includes("crime"));
      return {
        pass: hasCrimeGenre.length >= 6,
        details: `${hasCrimeGenre.length}/10 results have crime genre (need ≥6)`,
      };
    },
  },
];

/**
 * Run validation tests
 */
async function runValidationTests() {
  console.log("\n🧪 Running Descriptive Search Validation Tests\n");
  console.log("=".repeat(80));

  const results = {
    total: TEST_CASES.length,
    passed: 0,
    failed: 0,
    details: [],
  };

  for (const testCase of TEST_CASES) {
    console.log(`\n📝 Test: "${testCase.query}"`);
    console.log(`   Expected: ${testCase.expectation}`);

    try {
      const searchResults = await searchByVibe(testCase.query, 10);

      console.log(`\n   Top 10 Results:`);
      searchResults.slice(0, 10).forEach((result, idx) => {
        console.log(`   ${idx + 1}. ${result.title}`);
        console.log(`      Genres: ${result.genres?.join(", ") || "none"}`);
        console.log(`      Vibes: ${result.vibes?.join(", ") || "none"}`);
        console.log(`      Similarity: ${result.similarity?.toFixed(3) || "N/A"}`);
      });

      const validation = testCase.validateFn(searchResults);

      if (validation.pass) {
        console.log(`\n   ✅ PASSED: ${validation.details}`);
        results.passed++;
      } else {
        console.log(`\n   ❌ FAILED: ${validation.details}`);
        results.failed++;
      }

      results.details.push({
        query: testCase.query,
        passed: validation.pass,
        details: validation.details,
      });
    } catch (error) {
      console.error(`\n   ❌ ERROR: ${error.message}`);
      results.failed++;
      results.details.push({
        query: testCase.query,
        passed: false,
        details: `Error: ${error.message}`,
      });
    }

    console.log("\n" + "-".repeat(80));

    // Wait between tests to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n\n📊 Validation Summary:");
  console.log(`   Total tests: ${results.total}`);
  console.log(`   ✅ Passed: ${results.passed}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log(`   Success rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);

  if (results.passed === results.total) {
    console.log("\n🎉 All tests passed! Search quality is excellent.");
  } else if (results.passed >= results.total * 0.75) {
    console.log("\n✅ Most tests passed. Search quality is good.");
  } else {
    console.log("\n⚠️  Many tests failed. Consider further refinement of prompts.");
  }

  return results;
}

// Run tests
runValidationTests().catch(console.error);
