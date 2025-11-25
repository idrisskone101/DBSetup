/**
 * Apply Embeddings Script
 * 
 * Reads the JSON output from enrichment-pipeline.js and writes
 * the embeddings to the Supabase database.
 * 
 * Usage:
 *   node clean/apply-embeddings.js [path-to-json-file]
 * 
 * If no path is provided, it will look for the most recent
 * enrichment-pipeline-*.json file in the clean/ directory.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

// ============================================================================
// Supabase Setup
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find the most recent enrichment pipeline JSON file
 */
function findLatestPipelineJson() {
  const cleanDir = path.dirname(new URL(import.meta.url).pathname);
  const files = fs.readdirSync(cleanDir)
    .filter(f => f.startsWith("enrichment-pipeline-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  return path.join(cleanDir, files[0]);
}

/**
 * Update embeddings for a single title
 */
async function updateTitleEmbeddings(titleId, embeddings) {
  const { error } = await supabase
    .from("titles")
    .update({
      vibe_embedding: embeddings.vibe,
      content_embedding: embeddings.content,
      metadata_embedding: embeddings.metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", titleId);

  return error ? { success: false, error: error.message } : { success: true };
}

// ============================================================================
// Main Script
// ============================================================================

async function applyEmbeddings() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("💾 APPLY EMBEDDINGS TO DATABASE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Find input file
  let inputPath = process.argv[2];
  
  if (!inputPath) {
    inputPath = findLatestPipelineJson();
    if (!inputPath) {
      console.error("❌ No enrichment pipeline JSON file found.");
      console.error("   Run enrichment-pipeline.js first, or provide a file path.");
      process.exit(1);
    }
    console.log(`📂 Using latest file: ${path.basename(inputPath)}`);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ File not found: ${inputPath}`);
    process.exit(1);
  }

  // Read and parse JSON
  console.log(`📖 Reading: ${inputPath}\n`);
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));

  if (!data.titles || !Array.isArray(data.titles)) {
    console.error("❌ Invalid JSON format. Expected { titles: [...] }");
    process.exit(1);
  }

  // Filter titles with embeddings
  const titlesWithEmbeddings = data.titles.filter(t => t.embeddings && t.embeddings.vibe);

  if (titlesWithEmbeddings.length === 0) {
    console.log("⚠️  No titles with embeddings found in the file.");
    return;
  }

  console.log(`📊 Found ${titlesWithEmbeddings.length} titles with embeddings\n`);

  // Show pipeline metadata if available
  if (data.metadata) {
    console.log("📋 Pipeline run info:");
    console.log(`   Timestamp: ${data.metadata.timestamp}`);
    console.log(`   Duration: ${data.metadata.duration}`);
    console.log("");
  }

  // Ask for confirmation
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("⚠️  This will update the following columns in the database:");
  console.log("   - vibe_embedding");
  console.log("   - content_embedding");
  console.log("   - metadata_embedding");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Process titles
  const stats = { success: 0, failed: 0, errors: [] };
  const startTime = Date.now();

  console.log("🔄 Applying embeddings...\n");

  for (let i = 0; i < titlesWithEmbeddings.length; i++) {
    const title = titlesWithEmbeddings[i];
    const progress = `[${i + 1}/${titlesWithEmbeddings.length}]`;

    const result = await updateTitleEmbeddings(title.id, title.embeddings);

    if (result.success) {
      stats.success++;
      console.log(`${progress} ✓ ${title.title} (ID: ${title.id})`);
    } else {
      stats.failed++;
      stats.errors.push({ id: title.id, title: title.title, error: result.error });
      console.log(`${progress} ✗ ${title.title} - ${result.error}`);
    }
  }

  // Final summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✨ EMBEDDINGS APPLIED");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✓ Successfully updated: ${stats.success} titles`);
  console.log(`✗ Failed: ${stats.failed} titles`);
  console.log(`⏱️  Duration: ${duration}s`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (stats.errors.length > 0) {
    console.log("❌ Errors:");
    stats.errors.forEach((err) => {
      console.log(`   - ${err.title} (${err.id}): ${err.error}`);
    });
    console.log("");
  }

  console.log("💡 Embedding columns updated:");
  console.log("   - vibe_embedding (1536 dimensions)");
  console.log("   - content_embedding (1536 dimensions)");
  console.log("   - metadata_embedding (1536 dimensions)\n");
}

// Run the script
applyEmbeddings().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});

