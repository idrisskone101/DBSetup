import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";

/**
 * Check the current state of the data pipeline
 * Shows: title count, enrichment coverage, embedding coverage, cost estimates
 */
async function checkPipelineStatus() {
  console.log("\n🔍 PIPELINE STATUS CHECK\n");
  console.log("━".repeat(60));

  try {
    // Get total title count
    const { count: totalCount, error: countError } = await supabase
      .from("titles")
      .select("*", { count: "exact", head: true });

    if (countError) {
      throw new Error(`Failed to count titles: ${countError.message}`);
    }

    console.log(`📊 Total titles in database: ${totalCount}`);

    // Get enrichment coverage
    const { data: enrichmentStats, error: enrichmentError } = await supabase
      .from("titles")
      .select("profile_string, vibes, tone, pacing, themes");

    if (enrichmentError) {
      throw new Error(`Failed to fetch enrichment stats: ${enrichmentError.message}`);
    }

    const hasProfileString = enrichmentStats.filter((t) => t.profile_string).length;
    const hasVibes = enrichmentStats.filter((t) => t.vibes && t.vibes.length > 0).length;
    const hasTone = enrichmentStats.filter((t) => t.tone).length;
    const hasPacing = enrichmentStats.filter((t) => t.pacing).length;
    const hasThemes = enrichmentStats.filter((t) => t.themes && t.themes.length > 0).length;

    const needsEnrichment = totalCount - hasProfileString;
    const enrichmentPct = ((hasProfileString / totalCount) * 100).toFixed(1);
    const vibesPct = ((hasVibes / totalCount) * 100).toFixed(1);
    const tonePct = ((hasTone / totalCount) * 100).toFixed(1);

    console.log("\n📚 Enrichment Coverage:");
    console.log(`   Profile String: ${hasProfileString}/${totalCount} (${enrichmentPct}%)`);
    console.log(`   Vibes: ${hasVibes}/${totalCount} (${vibesPct}%)`);
    console.log(`   Tone: ${hasTone}/${totalCount} (${tonePct}%)`);
    console.log(`   Pacing: ${hasPacing}/${totalCount}`);
    console.log(`   Themes: ${hasThemes}/${totalCount}`);
    console.log(`   ⚠️  Needs enrichment: ${needsEnrichment} titles`);

    // Get embedding coverage
    const { data: embeddingStats, error: embeddingError } = await supabase
      .from("titles")
      .select("vibe_embedding, content_embedding, metadata_embedding");

    if (embeddingError) {
      throw new Error(`Failed to fetch embedding stats: ${embeddingError.message}`);
    }

    const hasVibeEmbedding = embeddingStats.filter((t) => t.vibe_embedding).length;
    const hasContentEmbedding = embeddingStats.filter((t) => t.content_embedding).length;
    const hasMetadataEmbedding = embeddingStats.filter((t) => t.metadata_embedding).length;
    const hasAllEmbeddings = embeddingStats.filter(
      (t) => t.vibe_embedding && t.content_embedding && t.metadata_embedding,
    ).length;

    const needsEmbeddings = totalCount - hasAllEmbeddings;
    const embeddingPct = ((hasAllEmbeddings / totalCount) * 100).toFixed(1);

    console.log("\n🤖 Embedding Coverage:");
    console.log(`   Vibe: ${hasVibeEmbedding}/${totalCount}`);
    console.log(`   Content: ${hasContentEmbedding}/${totalCount}`);
    console.log(`   Metadata: ${hasMetadataEmbedding}/${totalCount}`);
    console.log(`   All 3 embeddings: ${hasAllEmbeddings}/${totalCount} (${embeddingPct}%)`);
    console.log(`   ⚠️  Needs embeddings: ${needsEmbeddings} titles`);

    // Get highest TMDB ID (to avoid re-fetching)
    const { data: maxIdData, error: maxIdError } = await supabase
      .from("titles")
      .select("id")
      .order("id", { ascending: false })
      .limit(1);

    if (maxIdError) {
      throw new Error(`Failed to fetch max ID: ${maxIdError.message}`);
    }

    const maxId = maxIdData?.[0]?.id || 0;
    console.log(`\n🔢 Highest TMDB ID: ${maxId}`);

    // Get kind distribution
    const { data: kindStats, error: kindError } = await supabase
      .from("titles")
      .select("kind");

    if (kindError) {
      throw new Error(`Failed to fetch kind stats: ${kindError.message}`);
    }

    const movieCount = kindStats.filter((t) => t.kind === "movie").length;
    const tvCount = kindStats.filter((t) => t.kind === "tv").length;

    console.log("\n📺 Content Type Distribution:");
    console.log(`   Movies: ${movieCount}`);
    console.log(`   TV Shows: ${tvCount}`);

    // Cost estimates for next batch (1000 titles)
    const nextBatchSize = 1000;
    const enrichmentCost = (nextBatchSize * 0.0005).toFixed(2); // ~$0.0005 per title for LLM
    const embeddingCost = (nextBatchSize * 3 * 0.00002).toFixed(2); // 3 embeddings × $0.00002
    const totalCost = (parseFloat(enrichmentCost) + parseFloat(embeddingCost)).toFixed(2);

    console.log("\n💰 Cost Estimate (Next 1,000 Titles):");
    console.log(`   TMDB API: FREE`);
    console.log(`   Wikipedia API: FREE`);
    console.log(`   OpenAI Enrichment: ~$${enrichmentCost} (GPT-4o-mini)`);
    console.log(`   OpenAI Embeddings: ~$${embeddingCost} (text-embedding-3-small)`);
    console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Total: ~$${totalCost}`);

    // Health check summary
    console.log("\n" + "━".repeat(60));
    console.log("✅ PIPELINE HEALTH");
    console.log("━".repeat(60));

    const isHealthy = enrichmentPct >= 80 && embeddingPct >= 80;
    if (isHealthy) {
      console.log("🟢 Pipeline is healthy and ready for production");
    } else if (needsEnrichment > 0) {
      console.log("🟡 Pipeline needs enrichment");
      console.log(`   Run: npm run enrich (to process ${needsEnrichment} titles)`);
    }
    if (needsEmbeddings > 0) {
      console.log("🟡 Pipeline needs embeddings");
      console.log(`   Run: npm run backfill:multi:incremental (to process ${needsEmbeddings} titles)`);
    }

    console.log("\n📝 Next Actions:");
    if (totalCount < 500) {
      console.log("   1. Ingest more titles: npm run ingest:full");
      console.log("   2. Enrich new titles: npm run enrich");
      console.log("   3. Generate embeddings: npm run backfill:multi:incremental");
    } else {
      console.log("   ✅ Database is well-populated");
      console.log("   💡 Focus on improving search quality");
    }

    console.log("━".repeat(60) + "\n");
  } catch (error) {
    console.error("\n❌ Error checking pipeline status:", error.message);
    process.exit(1);
  }
}

checkPipelineStatus().catch((e) => {
  console.error(e);
  process.exit(1);
});
