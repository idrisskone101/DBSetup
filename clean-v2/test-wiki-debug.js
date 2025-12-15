/**
 * Debug test for Wikipedia fetcher
 */
import { validateArticle, isObviouslyWrong } from "./wikipedia/validator.js";

const BASE_URL = "https://en.wikipedia.org/api/rest_v1";
const SEARCH_URL = "https://en.wikipedia.org/w/api.php";

async function fetchArticle(title) {
  const encodedTitle = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `${BASE_URL}/page/summary/${encodedTitle}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  return res.json();
}

async function searchWiki(query) {
  const params = new URLSearchParams({
    action: "opensearch",
    search: query,
    limit: "5",
    namespace: "0",
    format: "json",
    origin: "*",
  });

  const res = await fetch(`${SEARCH_URL}?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data[1] || [];
}

// Test cases
const tests = [
  { title: "Mary Hartman, Mary Hartman", year: "1976", kind: "tv" },
  { title: "Dallas", year: "1978", kind: "tv" },
  { title: "Keeping Up Appearances", year: "1990", kind: "tv" },
];

console.log("=== Debug Wikipedia Fetch ===\n");

for (const test of tests) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: "${test.title}" (${test.year}) [${test.kind}]`);
  console.log("=".repeat(60));

  // Try the exact title first
  console.log(`\n1. Trying exact title: "${test.title}"`);
  let article = await fetchArticle(test.title);

  if (article) {
    console.log(`   Found article: "${article.title}"`);
    console.log(`   Extract (first 300 chars):`);
    console.log(`   "${article.extract?.slice(0, 300)}..."`);

    const obviouslyWrong = isObviouslyWrong(article.extract);
    console.log(`\n   Obviously wrong: ${obviouslyWrong}`);

    if (!obviouslyWrong) {
      const validation = validateArticle(
        { title: article.title, extract: article.extract, content: article.extract },
        test.title,
        test.year,
        test.kind,
        {}
      );
      console.log(`   Validation result: ${validation.isValid ? "VALID" : "INVALID"}`);
      console.log(`   Confidence: ${validation.confidence}`);
      console.log(`   Reasons: ${validation.reasons.join(", ")}`);
    }
  } else {
    console.log("   Not found");
  }

  // Try year-specific TV series pattern
  const yearPattern = `${test.title} (${test.year} TV series)`;
  console.log(`\n2. Trying: "${yearPattern}"`);
  article = await fetchArticle(yearPattern);

  if (article) {
    console.log(`   Found article: "${article.title}"`);
    console.log(`   Extract (first 300 chars):`);
    console.log(`   "${article.extract?.slice(0, 300)}..."`);

    const obviouslyWrong = isObviouslyWrong(article.extract);
    console.log(`\n   Obviously wrong: ${obviouslyWrong}`);

    if (!obviouslyWrong) {
      const validation = validateArticle(
        { title: article.title, extract: article.extract, content: article.extract },
        test.title,
        test.year,
        test.kind,
        {}
      );
      console.log(`   Validation result: ${validation.isValid ? "VALID" : "INVALID"}`);
      console.log(`   Confidence: ${validation.confidence}`);
      console.log(`   Reasons: ${validation.reasons.join(", ")}`);
    }
  } else {
    console.log("   Not found");
  }

  // Search fallback
  const searchQuery = `${test.title} ${test.year} TV series`;
  console.log(`\n3. Search results for: "${searchQuery}"`);
  const results = await searchWiki(searchQuery);
  console.log(`   Results: ${JSON.stringify(results)}`);

  // Small delay
  await new Promise(r => setTimeout(r, 500));
}

console.log("\n\nDone!");
