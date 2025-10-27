// TMDB enrichment script - backfill existing titles with cast, crew, keywords, etc.
// Does NOT generate embeddings - that happens later after all data is enriched
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import {
  getMovieDetails,
  getTvDetails,
  normalizeMovie,
  normalizeTv,
} from "./tmdb.js";
import { fileURLToPath } from "url";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Enrich a single title with TMDB data
 * @param {Object} row - Title row from Supabase
 * @returns {Promise<Object>} Result object with success/error info
 */
export async function enrichTitle(row) {
  console.log(
    `\n📚 Enriching: ${row.title} (ID: ${row.id}, Kind: ${row.kind})`,
  );

  try {
    // Fetch full TMDB details with enrichment data
    const detail =
      row.kind === "movie"
        ? await getMovieDetails(row.id)
        : await getTvDetails(row.id);

    // Normalize to extract all enrichment fields
    const normalized =
      row.kind === "movie" ? normalizeMovie(detail) : normalizeTv(detail);

    console.log(`✅ Fetched TMDB data`);
    console.log(`   - Cast: ${normalized.cast?.length || 0} members`);
    console.log(`   - Director: ${normalized.director || "none"}`);
    console.log(`   - Writers: ${normalized.writers?.length || 0}`);
    console.log(`   - Creators: ${normalized.creators?.length || 0}`);
    console.log(`   - Keywords: ${normalized.keywords?.length || 0}`);
    console.log(`   - Certification: ${normalized.certification || "none"}`);
    console.log(`   - Collection: ${normalized.collection_name || "none"}`);

    // Update Supabase with enriched data (excluding fields that already exist)
    const updateData = {
      cast: normalized.cast,
      director: normalized.director,
      writers: normalized.writers,
      creators: normalized.creators,
      collection_id: normalized.collection_id,
      collection_name: normalized.collection_name,
      certification: normalized.certification,
      production_countries: normalized.production_countries,
      keywords: normalized.keywords,
      tagline: normalized.tagline,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("titles")
      .update(updateData)
      .eq("id", row.id);

    if (updateError) {
      throw new Error(`Supabase update failed: ${updateError.message}`);
    }

    console.log(`✅ Updated Supabase record`);

    return {
      success: true,
      id: row.id,
      title: row.title,
      cast_count: normalized.cast?.length || 0,
      keywords_count: normalized.keywords?.length || 0,
    };
  } catch (error) {
    console.error(`❌ Error enriching ${row.title}:`, error.message);
    return {
      success: false,
      id: row.id,
      title: row.title,
      error: error.message,
    };
  }
}

/**
 * Enrich multiple titles with rate limiting
 * @param {Array} rows - Array of title rows from Supabase
 * @param {Object} options - Options for enrichment
 * @param {number} options.delayMs - Delay between requests (default 500ms)
 * @returns {Promise<Object>} Summary of results
 */
export async function enrichTitles(rows, options = {}) {
  const { delayMs = 500 } = options;

  const results = {
    total: rows.length,
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`\n[${i + 1}/${rows.length}] Processing: ${row.title}`);

    const result = await enrichTitle(row);

    if (result.success) {
      results.success++;
    } else {
      results.failed++;
      results.errors.push({
        id: result.id,
        title: result.title,
        error: result.error,
      });
    }

    // Rate limiting - respect TMDB API limits
    if (i < rows.length - 1) {
      console.log(`⏸️  Waiting ${delayMs}ms before next request...`);
      await sleep(delayMs);
    }
  }

  return results;
}

/**
 * Query titles that need enrichment
 * @param {number} limit - Max number of titles to fetch
 * @returns {Promise<Array>} Array of title rows
 */
export async function getTitlesNeedingEnrichment(limit = 100) {
  const { data, error } = await supabase
    .from("titles")
    .select("id, kind, title, release_date")
    .is("cast", null) // Fetch titles without enrichment data
    .order("popularity", { ascending: false, nullsLast: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to query titles: ${error.message}`);
  }

  return data || [];
}

// CLI entrypoint
async function main() {
  const limit = parseInt(process.argv[2]) || 200;

  console.log(`\n🚀 TMDB Enrichment Script`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(`Fetching up to ${limit} titles needing enrichment...\n`);

  const rows = await getTitlesNeedingEnrichment(limit);

  if (rows.length === 0) {
    console.log(`✨ No titles need enrichment!`);
    process.exit(0);
  }

  console.log(`Found ${rows.length} titles to enrich\n`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const startTime = Date.now();
  const results = await enrichTitles(rows, { delayMs: 500 });
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✨ ENRICHMENT COMPLETE`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Successfully enriched: ${results.success} titles`);
  console.log(`⚠️  Failed/Skipped: ${results.failed} titles`);
  console.log(`⏱️  Duration: ${duration}s`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (results.errors.length > 0) {
    console.log(`\n❌ Errors:`);
    results.errors.forEach((err) => {
      console.log(`   - ${err.title} (${err.id}): ${err.error}`);
    });
  }

  console.log(
    `\n📝 Note: Embeddings NOT generated. Run embedding script separately when ready.\n`,
  );
}

// Run if called directly (check if this file is the entry point)
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;

if (isMainModule) {
  main().catch((error) => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  });
}
