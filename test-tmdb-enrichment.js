// Test TMDB enrichment on a single well-known movie
import "dotenv/config.js";
import { getMovieDetails, normalizeMovie } from "./tmdb.js";

async function testEnrichment() {
  console.log("\n🧪 Testing TMDB Enrichment");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Test with Inception (550) - a well-documented movie with rich metadata
  const movieId = 550; // Fight Club
  console.log(`Fetching movie details for ID: ${movieId}...\n`);

  try {
    const detail = await getMovieDetails(movieId);
    const normalized = normalizeMovie(detail);

    console.log("✅ Successfully fetched and normalized movie data\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("📋 BASIC INFO:");
    console.log(`   Title: ${normalized.title}`);
    console.log(`   Release Date: ${normalized.release_date}`);
    console.log(`   Runtime: ${normalized.runtime_minutes} minutes`);
    console.log(`   Genres: ${normalized.genres.join(", ")}`);
    console.log(`   Rating: ${normalized.vote_average}/10\n`);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("🎭 ENTITY DATA (People):");
    console.log(`   Director: ${normalized.director || "N/A"}`);
    console.log(`   Writers: ${normalized.writers?.join(", ") || "N/A"}`);
    console.log(`   Creators: ${normalized.creators?.join(", ") || "N/A (movies don't have creators)"}`);

    if (normalized.cast && normalized.cast.length > 0) {
      console.log(`\n   Cast (Top ${Math.min(10, normalized.cast.length)}):`);
      normalized.cast.forEach((member, idx) => {
        const char = member.character ? ` as ${member.character}` : "";
        console.log(`      ${idx + 1}. ${member.name}${char}`);
      });
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("🏷️  ANCHOR DATA (Classification):");
    console.log(`   Collection: ${normalized.collection_name || "N/A"}`);
    console.log(`   Collection ID: ${normalized.collection_id || "N/A"}`);
    console.log(`   Certification: ${normalized.certification || "N/A"}`);
    console.log(`   Production Countries: ${normalized.production_countries?.join(", ") || "N/A"}`);
    console.log(`   Tagline: ${normalized.tagline || "N/A"}`);

    if (normalized.keywords && normalized.keywords.length > 0) {
      console.log(`\n   Keywords (${normalized.keywords.length} total):`);
      console.log(`      ${normalized.keywords.slice(0, 15).join(", ")}`);
      if (normalized.keywords.length > 15) {
        console.log(`      ... and ${normalized.keywords.length - 15} more`);
      }
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("📊 DATA COMPLETENESS:");
    const fields = {
      "Director": !!normalized.director,
      "Writers": !!(normalized.writers?.length > 0),
      "Cast": !!(normalized.cast?.length > 0),
      "Keywords": !!(normalized.keywords?.length > 0),
      "Certification": !!normalized.certification,
      "Collection": !!normalized.collection_name,
      "Tagline": !!normalized.tagline,
      "Production Countries": !!(normalized.production_countries?.length > 0),
    };

    Object.entries(fields).forEach(([field, present]) => {
      const icon = present ? "✅" : "❌";
      console.log(`   ${icon} ${field}`);
    });

    const completeness = Object.values(fields).filter(Boolean).length / Object.keys(fields).length * 100;
    console.log(`\n   Overall Completeness: ${completeness.toFixed(1)}%`);

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    console.log("✨ Test completed successfully!");
    console.log("\nNext steps:");
    console.log("1. Run 'npm run enrich:tmdb' to enrich all existing titles");
    console.log("2. After enrichment, regenerate embeddings with richer content");
    console.log("\n");

  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    console.error(error);
    process.exit(1);
  }
}

testEnrichment();
