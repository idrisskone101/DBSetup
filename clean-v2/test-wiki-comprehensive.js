/**
 * Comprehensive test for Wikipedia title normalization
 */
import { WikipediaFetcher } from "./wikipedia/fetcher.js";
import { RateLimiter } from "./lib/rate-limiter.js";
import { normalizeTitle, titlesMatch } from "./wikipedia/title-normalizer.js";

const rateLimiter = new RateLimiter(200);
const fetcher = new WikipediaFetcher(rateLimiter);

// Test normalization
console.log("=== Testing Title Normalization ===\n");

const normalizationTests = [
  ["Rocky III", "Rocky 3"],
  ["Kill Bill: Vol. 1", "Kill Bill: Volume 1"],
  ["Fast & Furious", "Fast and Furious"],
  ["Dr. Strangelove", "Doctor Strangelove"],
  ["St. Elmo's Fire", "Saint Elmo's Fire"],
  ["The Matrix", "Matrix"],
  ["Léon", "Leon"],
  ["Amélie", "Amelie"],
];

for (const [input, expected] of normalizationTests) {
  const normalized = normalizeTitle(input);
  const matches = titlesMatch(input, expected);
  console.log(`"${input}" → "${normalized}"`);
  console.log(`  Matches "${expected}": ${matches ? "✓" : "✗"}`);
}

// Test pattern generation
console.log("\n=== Testing Pattern Generation ===\n");

const patternTests = [
  { title: "Rocky III", year: "1982", kind: "movie" },
  { title: "Fast & Furious", year: "2009", kind: "movie" },
  { title: "Dr. Who", year: "1963", kind: "tv" },
];

for (const test of patternTests) {
  console.log(`\nTitle: "${test.title}" (${test.year}) [${test.kind}]`);
  const patterns = fetcher.generateTitlePatterns(test.title, test.year, test.kind);
  patterns.slice(0, 8).forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  if (patterns.length > 8) console.log(`  ... and ${patterns.length - 8} more`);
}

// Test actual Wikipedia fetching
console.log("\n\n=== Testing Wikipedia Fetch ===\n");

const fetchTests = [
  // Original problem titles
  { title: "Dallas", year: "1978", kind: "tv" },
  { title: "Keeping Up Appearances", year: "1990", kind: "tv" },
  { title: "Mary Hartman, Mary Hartman", year: "1976", kind: "tv" },
  // Colon/abbreviation titles
  { title: "Kill Bill: Vol. 1", year: "2003", kind: "movie" },
  { title: "Star Wars: Droids", year: "1985", kind: "tv" },
  { title: "Clerks", year: "1994", kind: "movie" },
  // Roman numerals
  { title: "Rocky III", year: "1982", kind: "movie" },
  // Ampersand
  { title: "Law & Order", year: "1990", kind: "tv" },
];

let passed = 0;
let failed = 0;

for (const test of fetchTests) {
  process.stdout.write(`${test.title} (${test.year})... `);
  try {
    const result = await fetcher.fetchForTitle(test.title, test.year, test.kind, {});
    if (result) {
      console.log(`✓ (${result.confidence})`);
      passed++;
    } else {
      console.log(`✗ NOT FOUND`);
      failed++;
    }
  } catch (error) {
    console.log(`✗ ERROR: ${error.message}`);
    failed++;
  }
}

console.log(`\n=== Results: ${passed}/${fetchTests.length} passed ===`);
