/**
 * Final test - all problem titles
 */
import { WikipediaFetcher } from "./wikipedia/fetcher.js";
import { RateLimiter } from "./lib/rate-limiter.js";

const rateLimiter = new RateLimiter(200);
const fetcher = new WikipediaFetcher(rateLimiter);

const tests = [
  // Original problem titles
  { title: "Dallas", year: "1978", kind: "tv" },
  { title: "Keeping Up Appearances", year: "1990", kind: "tv" },
  { title: "Mary Hartman, Mary Hartman", year: "1976", kind: "tv" },
  // New problem titles
  { title: "Kill Bill: Vol. 1", year: "2003", kind: "movie" },
  { title: "Star Wars: Droids", year: "1985", kind: "tv" },
  { title: "Clerks", year: "1994", kind: "movie" },
];

console.log("=== Testing All Problem Titles ===\n");

let passed = 0;
let failed = 0;

for (const test of tests) {
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

console.log(`\n=== Results: ${passed}/${tests.length} passed ===`);
