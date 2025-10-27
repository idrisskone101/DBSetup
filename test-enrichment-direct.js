// Direct test of enrichment pipeline with a known Wikipedia page
import "dotenv/config.js";
import { enrichTitleRow } from "./enrich-titles.js";

// Mock title row for Inception (a movie we know has a good Wikipedia page)
const mockTitle = {
  id: 99999, // Fake ID for testing
  kind: "movie",
  title: "Inception",
  release_date: "2010-07-16",
  runtime_minutes: 148,
  genres: ["Action", "Science Fiction", "Adventure"],
  payload: {},
};

console.log("🧪 Testing enrichment with Inception (2010)...\n");

enrichTitleRow(mockTitle, "Inception (2010 film)")
  .then((result) => {
    console.log("\n✅ Test complete!");
    console.log("Result:", JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
