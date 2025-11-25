/**
 * TMDB Metadata Backfill Script
 * Enriches titles with missing metadata from TMDB API
 * Test mode: processes only 50 titles
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { getMovieDetails, getTvDetails, sleep, checkConnection } from "./client.js";
import { extractAllMetadata } from "./extractors.js";
import { normalizeGenre } from "../genre-standardizer.js";

// ============================================================================
// Configuration
// ============================================================================

const TEST_LIMIT = 50; // Limit to 50 titles for testing
const RATE_LIMIT_DELAY_MS = 500; // 500ms between TMDB requests (2 req/sec)

// ============================================================================
// Environment Setup (Manual .env parsing)
// ============================================================================

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// ============================================================================
// Supabase Client Setup
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase credentials in .env file");
  console.error("   Required: SUPABASE_URL and (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// Database Queries
// ============================================================================

/**
 * Fetch titles for metadata enrichment (top by popularity)
 * @returns {Promise<Array>} Array of title records
 */
async function getTitlesForEnrichment() {
  console.log(`📊 Fetching ${TEST_LIMIT} titles by popularity...`);

  const { data, error } = await supabase
    .from("titles")
    .select("id, kind, title")
    .order("popularity", { ascending: false, nullsFirst: false })
    .limit(TEST_LIMIT);

  if (error) {
    throw new Error(`Failed to fetch titles: ${error.message}`);
  }

  return data || [];
}

/**
 * Update a title in the database with TMDB metadata
 * @param {number} titleId - The title ID
 * @param {Object} metadata - Extracted TMDB metadata
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateTitleMetadata(titleId, metadata) {
  const updateData = {
    cast: metadata.cast || null,
    director: metadata.director || null,
    writers: metadata.writers || [],
    creators: metadata.creators || [],
    keywords: metadata.keywords || [],
    genres: metadata.genres || [],
    certification: metadata.certification || null,
    production_countries: metadata.production_countries || [],
    collection_id: metadata.collection_id || null,
    collection_name: metadata.collection_name || null,
    tagline: metadata.tagline || null,
    providers: metadata.providers || null,
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

// ============================================================================
// Enrichment Logic
// ============================================================================

/**
 * Enrich a single title with TMDB data
 * @param {Object} title - Title record {id, kind, title}
 * @returns {Promise<{success: boolean, metadata?: Object, error?: string}>}
 */
async function enrichTitle(title) {
  try {
    // Fetch from TMDB based on type
    const detail =
      title.kind === "movie"
        ? await getMovieDetails(title.id)
        : await getTvDetails(title.id);

    // Extract all metadata
    const metadata = extractAllMetadata(detail, title.kind);

    // Standardize genres using genre-standardizer
    if (metadata.genres && metadata.genres.length > 0) {
      const standardizedGenres = new Set();
      for (const genre of metadata.genres) {
        const normalized = normalizeGenre(genre);
        normalized.forEach(g => standardizedGenres.add(g));
      }
      metadata.genres = [...standardizedGenres];
    }

    return { success: true, metadata };
  } catch (error) {
    const status = error.response?.status;
    if (status === 404) {
      return { success: false, error: "Not found in TMDB" };
    }
    return { success: false, error: error.message };
  }
}

/**
 * Format metadata summary for logging
 * @param {Object} metadata - Extracted metadata
 * @param {string} kind - "movie" or "tv"
 * @returns {string[]} Array of formatted lines
 */
function formatMetadataSummary(metadata, kind) {
  const lines = [];
  
  lines.push(`  ✓ Cast: ${metadata.cast?.length || 0} members`);
  
  if (kind === "movie") {
    lines.push(`  ✓ Director: ${metadata.director || "(none)"}`);
  } else {
    lines.push(`  ✓ Director: ${metadata.director || "(N/A for TV)"}`);
  }
  
  lines.push(`  ✓ Writers: ${metadata.writers?.length || 0}`);
  
  if (kind === "tv") {
    lines.push(`  ✓ Creators: ${metadata.creators?.length || 0}`);
  }
  
  lines.push(`  ✓ Keywords: ${metadata.keywords?.length || 0}`);
  lines.push(`  ✓ Genres: ${metadata.genres?.join(", ") || "(none)"}`);
  lines.push(`  ✓ Certification: ${metadata.certification || "(none)"}`);
  lines.push(`  ✓ Countries: ${metadata.production_countries?.join(", ") || "(none)"}`);
  
  if (kind === "movie" && metadata.collection_name) {
    lines.push(`  ✓ Collection: ${metadata.collection_name}`);
  }
  
  if (metadata.providers) {
    const providerCount =
      (metadata.providers.flatrate?.length || 0) +
      (metadata.providers.rent?.length || 0) +
      (metadata.providers.buy?.length || 0);
    lines.push(`  ✓ Providers: ${providerCount} (${metadata.providers.region})`);
  } else {
    lines.push(`  ✓ Providers: (none)`);
  }
  
  return lines;
}

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎬 TMDB METADATA BACKFILL SCRIPT");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Check TMDB connection
  console.log("🔌 Checking TMDB API connection...");
  const connected = await checkConnection();
  if (!connected) {
    console.error("❌ Cannot connect to TMDB API. Check your TMDB_TOKEN.");
    process.exit(1);
  }
  console.log("✓ TMDB API connected\n");

  // Fetch titles for enrichment
  const titles = await getTitlesForEnrichment();

  if (titles.length === 0) {
    console.log("⚠️  No titles found in database.");
    return;
  }

  console.log(`\n📋 Found ${titles.length} titles to process\n`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Track results
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  // Collect enriched records for JSON output
  const enrichedRecords = [];

  const startTime = Date.now();

  // Process each title
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    const progress = `[${i + 1}/${titles.length}]`;

    console.log(`${progress} ${title.title} (ID: ${title.id}, Type: ${title.kind})`);
    console.log("  Fetching TMDB data...");

    const result = await enrichTitle(title);

    if (result.success) {
      const summaryLines = formatMetadataSummary(result.metadata, title.kind);
      summaryLines.forEach((line) => console.log(line));
      
      // Write to database
      console.log("  💾 Writing to database...");
      const dbResult = await updateTitleMetadata(title.id, result.metadata);
      
      if (dbResult.success) {
        results.success++;
        console.log("  ✓ Database updated\n");

        // Add to enriched records array
        enrichedRecords.push({
          id: title.id,
          kind: title.kind,
          title: title.title,
          metadata: result.metadata,
          enrichedAt: new Date().toISOString(),
          dbUpdated: true,
        });
      } else {
        results.failed++;
        results.errors.push({ id: title.id, title: title.title, error: `DB update failed: ${dbResult.error}` });
        console.log(`  ✗ Database update failed: ${dbResult.error}\n`);
        
        // Still add to records but mark as not updated
        enrichedRecords.push({
          id: title.id,
          kind: title.kind,
          title: title.title,
          metadata: result.metadata,
          enrichedAt: new Date().toISOString(),
          dbUpdated: false,
          dbError: dbResult.error,
        });
      }
    } else {
      results.failed++;
      results.errors.push({ id: title.id, title: title.title, error: result.error });
      console.log(`  ✗ Failed: ${result.error}\n`);
    }

    // Rate limiting (skip on last item)
    if (i < titles.length - 1) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  // Final summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Write JSON output file
  const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const outputFilename = `tmdb-backfill-${timestamp}.json`;
  const outputPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", outputFilename);

  fs.writeFileSync(outputPath, JSON.stringify(enrichedRecords, null, 2), "utf8");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✨ ENRICHMENT COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✓ Successfully enriched & saved to DB: ${results.success} titles`);
  console.log(`✗ Failed: ${results.failed} titles`);
  console.log(`⏱️  Duration: ${duration}s`);
  console.log(`📄 Backup JSON: ${outputPath}`);
  console.log(`   Records written: ${enrichedRecords.length}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Show errors if any
  if (results.errors.length > 0) {
    console.log("❌ Errors:");
    results.errors.forEach((err) => {
      console.log(`   - ${err.title} (${err.id}): ${err.error}`);
    });
    console.log("");
  }

  console.log("📝 Note: This script writes directly to the database.");
  console.log(`   Processed ${TEST_LIMIT} titles. Update TEST_LIMIT to process more.\n`);
}

// Run the script
main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});

