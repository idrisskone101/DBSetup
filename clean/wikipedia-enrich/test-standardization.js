import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { getWikiContent } from "./wikipedia-fetcher.js";
import { extractStandardizedMetadata, createEmptyMetadata } from "./llm-extractor.js";

dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const TEST_LIMIT = 50; // Process 50 titles to match TMDB backfill

// ============================================================================
// Supabase Setup
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// Database Functions
// ============================================================================

/**
 * Update a title in the database with Wikipedia-extracted metadata
 * Stores vibes as JSONB object with scores (not converted to array)
 * @param {number} titleId - The title ID
 * @param {Object} metadata - Extracted metadata (vibes, themes, tone, pacing)
 * @param {string} wikiSourceUrl - Wikipedia source URL for attribution
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateTitleWikipediaMetadata(titleId, metadata, wikiSourceUrl = null) {
  const updateData = {
    vibes: metadata.vibes || null, // Store as JSONB object with scores
    themes: metadata.themes || [],
    tone: metadata.tone || null,
    pacing: metadata.pacing || null,
    wiki_source_url: wikiSourceUrl,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("titles")
    .update(updateData)
    .eq("id", titleId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

async function runTest() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📚 WIKIPEDIA METADATA ENRICHMENT SCRIPT");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 1. Fetch titles by popularity
  console.log(`📊 Fetching ${TEST_LIMIT} titles by popularity...`);
  
  const { data: titles, error } = await supabase
    .from("titles")
    .select("id, title, release_date, kind, genres")
    .order("popularity", { ascending: false, nullsFirst: false })
    .limit(TEST_LIMIT);

  if (error) {
    console.error("❌ Error fetching titles:", error.message);
    process.exit(1);
  }

  if (!titles || titles.length === 0) {
    console.log("⚠️  No titles found in database.");
    return;
  }

  console.log(`📥 Found ${titles.length} titles to process.\n`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const results = [];
  const stats = { success: 0, failed: 0, noWiki: 0 };
  const startTime = Date.now();

  // 2. Process each title
  for (const [index, title] of titles.entries()) {
    console.log(`[${index + 1}/${titles.length}] ${title.title} (ID: ${title.id})`);

    try {
      const year = title.release_date ? title.release_date.slice(0, 4) : undefined;
      
      // Fetch Wikipedia content
      console.log("  📖 Fetching Wikipedia content...");
      const { summary, plot, foundTitle, url: wikiUrl } = await getWikiContent(title.title, {
        year,
        kind: title.kind,
      });

      const wikiText = [summary, plot].filter(Boolean).join("\n\n");

      if (!wikiText) {
        console.log("  ⚠️  No Wikipedia content found.\n");
        stats.noWiki++;
        results.push({
          id: title.id,
          title: title.title,
          foundWikiTitle: null,
          standardized: createEmptyMetadata(),
          status: "no_wiki_content",
          dbUpdated: false,
        });
        continue;
      }

      console.log(`  ✅ Found Wiki: "${foundTitle}"`);

      // Extract Metadata using LLM
      console.log("  🤖 Extracting metadata with LLM...");
      const metadata = await extractStandardizedMetadata(wikiText, {
        title: title.title,
        year,
        kind: title.kind,
        genres: title.genres,
      });

      // Log extracted vibes (top 5 by score)
      const topVibes = Object.entries(metadata.vibes || {})
        .filter(([_, score]) => score >= 0.3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([vibe, score]) => `${vibe}: ${score.toFixed(2)}`)
        .join(", ");
      
      console.log(`  ✨ Vibes: ${topVibes || "(none significant)"}`);
      console.log(`  ✨ Tone: ${metadata.tone}, Pacing: ${metadata.pacing}`);
      console.log(`  ✨ Themes: ${metadata.themes?.join(", ") || "(none)"}`);

      // Write to database
      console.log("  💾 Writing to database...");
      const dbResult = await updateTitleWikipediaMetadata(title.id, metadata, wikiUrl);

      if (dbResult.success) {
        stats.success++;
        console.log("  ✓ Database updated\n");
        
        results.push({
          id: title.id,
          title: title.title,
          foundWikiTitle: foundTitle,
          wikiUrl,
          standardized: metadata,
          status: "success",
          dbUpdated: true,
        });
      } else {
        stats.failed++;
        console.log(`  ✗ Database update failed: ${dbResult.error}\n`);
        
        results.push({
          id: title.id,
          title: title.title,
          foundWikiTitle: foundTitle,
          standardized: metadata,
          status: "db_error",
          dbUpdated: false,
          dbError: dbResult.error,
        });
      }

    } catch (err) {
      console.error(`  ❌ Error: ${err.message}\n`);
      stats.failed++;
      results.push({
        id: title.id,
        title: title.title,
        status: "error",
        error: err.message,
        dbUpdated: false,
      });
    }
  }

  // 3. Save results to JSON backup
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const timestamp = new Date().toISOString().split("T")[0];
  const outputPath = path.join("clean", `wikipedia-enrichment-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  // 4. Final summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✨ WIKIPEDIA ENRICHMENT COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✓ Successfully enriched & saved to DB: ${stats.success} titles`);
  console.log(`⚠️  No Wikipedia content: ${stats.noWiki} titles`);
  console.log(`✗ Failed: ${stats.failed} titles`);
  console.log(`⏱️  Duration: ${duration}s`);
  console.log(`📄 Backup JSON: ${outputPath}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

runTest();