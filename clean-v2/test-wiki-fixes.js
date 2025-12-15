/**
 * Quick test for Wikipedia fetcher fixes
 */
import { WikipediaFetcher } from "./wikipedia/fetcher.js";
import { RateLimiter } from "./lib/rate-limiter.js";

const rateLimiter = new RateLimiter(200);
const fetcher = new WikipediaFetcher(rateLimiter);

// Test title pattern generation
const testCases = [
  { title: "Mary Hartman, Mary Hartman", year: "1976", kind: "tv" },
  { title: "Dallas", year: "1978", kind: "tv" },
  { title: "Keeping Up Appearances", year: "1990", kind: "tv" },
];

console.log("=== Testing Title Pattern Generation ===\n");

for (const test of testCases) {
  console.log(`Title: "${test.title}" (${test.year}) [${test.kind}]`);
  const patterns = fetcher.generateTitlePatterns(test.title, test.year, test.kind);
  patterns.forEach((p, idx) => console.log(`  ${idx + 1}. ${p}`));
  console.log();
}

console.log("=== Testing Wikipedia Fetch ===\n");

for (const test of testCases) {
  console.log(`Fetching: "${test.title}" (${test.year})...`);
  try {
    const result = await fetcher.fetchForTitle(test.title, test.year, test.kind, {});
    if (result) {
      console.log(`  ✓ Found: ${result.url}`);
      console.log(`  Confidence: ${result.confidence}`);
    } else {
      console.log(`  ✗ No valid article found`);
    }
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }
  console.log();
}

console.log("Done!");
