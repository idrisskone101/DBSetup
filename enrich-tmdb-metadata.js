// TMDB Metadata Enrichment Script
// Fetches missing TMDB metadata (cast, director, writers, keywords, certification)
// and regenerates metadata embeddings for all titles
// Processes in batches of 500 automatically

import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import {
  getMovieDetails,
  getTvDetails,
  normalizeMovie,
  normalizeTv,
} from "./tmdb.js";
import { generateMetadataEmbeddings } from "./embeddings.js";
import { fileURLToPath } from "url";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BATCH_SIZE = 500;
const TMDB_DELAY_MS = 500; // 2 req/sec, well below TMDB's 40/sec limit
const MAX_RETRIES = 3; // Maximum retry attempts for Supabase operations
const RETRY_DELAY_MS = 2000; // Initial retry delay (will increase exponentially)

/**
 * Query titles that need TMDB metadata enrichment
 * @param {number} offset - Pagination offset
 * @param {number} limit - Batch size
 * @returns {Promise<Array>} Array of title rows
 */
async function getTitlesNeedingTMDBEnrichment(offset = 0, limit = 500) {
  const { data, error } = await supabase
    .from("titles")
    .select("id, kind, title, release_date, genres, popularity")
    .or(
      'cast.is.null,director.is.null,writers.is.null,keywords.is.null'
    )
    .order("popularity", { ascending: false, nullsLast: true })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Failed to query titles: ${error.message}`);
  }

  return data || [];
}

/**
 * Retry a Supabase operation with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {string} operationName - Name for logging
 * @param {number} maxRetries - Maximum retry attempts
 * @returns {Promise<any>} Result of the operation
 */
async function retrySupabaseOperation(operation, operationName, maxRetries = MAX_RETRIES) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isTimeout = 
        error.message?.toLowerCase().includes('timeout') ||
        error.message?.toLowerCase().includes('timed out') ||
        error.code === 'ETIMEDOUT' ||
        error.code === '57014'; // PostgreSQL query timeout
      
      if (attempt < maxRetries && isTimeout) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`⚠️  ${operationName} timed out (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`);
        await sleep(delay);
      } else if (attempt < maxRetries) {
        const delay = RETRY_DELAY_MS;
        console.log(`⚠️  ${operationName} failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        console.error(`❌ ${operationName} failed after ${maxRetries} attempts`);
        throw lastError;
      }
    }
  }
  
  throw lastError;
}

/**
 * Count total titles needing TMDB enrichment
 * @returns {Promise<number>}
 */
async function countTitlesNeedingEnrichment() {
  const { count, error } = await supabase
    .from("titles")
    .select("id", { count: "exact", head: true })
    .or(
      'cast.is.null,director.is.null,writers.is.null,keywords.is.null'
    );

  if (error) {
    throw new Error(`Failed to count titles: ${error.message}`);
  }

  return count || 0;
}

/**
 * Enrich a single title with TMDB metadata and update embedding
 * @param {Object} row - Title row from Supabase
 * @returns {Promise<Object>} Result object with success/error info
 */
async function enrichTitleWithMetadata(row) {
  console.log(
    `\n📚 Enriching: ${row.title} (ID: ${row.id}, Kind: ${row.kind})`
  );

  try {
    // Fetch full TMDB details
    const detail =
      row.kind === "movie"
        ? await getMovieDetails(row.id)
        : await getTvDetails(row.id);

    // Check if TMDB has data
    if (!detail || !detail.id) {
      console.log(`⚠️  No TMDB data available for ${row.title}, skipping...`);
      return {
        success: true,
        skipped: true,
        id: row.id,
        title: row.title,
        reason: "No TMDB data available",
      };
    }

    // Normalize to extract enrichment fields
    const normalized =
      row.kind === "movie" ? normalizeMovie(detail) : normalizeTv(detail);

    console.log(`✅ Fetched TMDB data`);
    console.log(`   - Cast: ${normalized.cast?.length || 0} members`);
    console.log(`   - Director: ${normalized.director || "none"}`);
    console.log(`   - Writers: ${normalized.writers?.length || 0}`);
    console.log(`   - Creators: ${normalized.creators?.length || 0}`);
    console.log(`   - Keywords: ${normalized.keywords?.length || 0}`);
    console.log(`   - Certification: ${normalized.certification || "none"}`);

    // Prepare update data with new metadata
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

    // Update metadata in database with retry logic
    await retrySupabaseOperation(
      async () => {
        const { error: updateError } = await supabase
          .from("titles")
          .update(updateData)
          .eq("id", row.id);

        if (updateError) {
          throw new Error(`Supabase metadata update failed: ${updateError.message}`);
        }
      },
      `Metadata update for "${row.title}"`
    );

    console.log(`✅ Updated metadata in database`);

    // Fetch the updated title to regenerate embedding with retry logic
    const updatedTitle = await retrySupabaseOperation(
      async () => {
        const { data, error: fetchError } = await supabase
          .from("titles")
          .select("*")
          .eq("id", row.id)
          .single();

        if (fetchError) {
          throw new Error(`Failed to fetch updated title: ${fetchError.message}`);
        }
        
        return data;
      },
      `Fetch updated title "${row.title}"`
    );

    // Generate new metadata embedding
    console.log(`🏷️  Regenerating metadata embedding...`);
    const [metadataEmbedding] = await generateMetadataEmbeddings([updatedTitle]);

    if (!metadataEmbedding) {
      console.log(`⚠️  Failed to generate embedding, but metadata was updated`);
      return {
        success: true,
        id: row.id,
        title: row.title,
        metadata_updated: true,
        embedding_updated: false,
      };
    }

    // Update embedding in database with retry logic
    await retrySupabaseOperation(
      async () => {
        const { error: embeddingError } = await supabase
          .from("titles")
          .update({
            metadata_embedding: metadataEmbedding,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (embeddingError) {
          throw new Error(`Embedding update failed: ${embeddingError.message}`);
        }
      },
      `Embedding update for "${row.title}"`
    );

    console.log(`✅ Updated metadata embedding`);

    return {
      success: true,
      id: row.id,
      title: row.title,
      metadata_updated: true,
      embedding_updated: true,
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
 * Process a single batch of titles
 * @param {number} batchNum - Batch number (for display)
 * @param {number} offset - Database offset
 * @param {number} limit - Batch size
 * @returns {Promise<Object>} Batch results
 */
async function processBatch(batchNum, offset, limit) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📦 BATCH ${batchNum} - Offset: ${offset}, Limit: ${limit}`);
  console.log(`${"=".repeat(70)}`);

  const rows = await getTitlesNeedingTMDBEnrichment(offset, limit);

  if (rows.length === 0) {
    console.log(`\n✨ No titles in this batch (all done!)`);
    return {
      processed: 0,
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
  }

  console.log(`\nFound ${rows.length} titles to process in this batch\n`);

  const results = {
    processed: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`\n[${i + 1}/${rows.length}] Processing: ${row.title}`);

    const result = await enrichTitleWithMetadata(row);
    results.processed++;

    if (result.success) {
      if (result.skipped) {
        results.skipped++;
      } else {
        results.success++;
      }
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
      await sleep(TMDB_DELAY_MS);
    }
  }

  // Summary for this batch
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📊 BATCH ${batchNum} COMPLETE`);
  console.log(`${"=".repeat(70)}`);
  console.log(`✅ Successfully enriched: ${results.success}`);
  console.log(`⏭️  Skipped (no TMDB data): ${results.skipped}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`${"=".repeat(70)}\n`);

  return results;
}

/**
 * Main function - Process all batches sequentially
 */
async function main() {
  console.log(`\n🚀 TMDB METADATA ENRICHMENT & EMBEDDING REGENERATION`);
  console.log(`${"━".repeat(70)}\n`);

  // Count total titles needing enrichment
  console.log(`📊 Analyzing database...`);
  const totalTitles = await countTitlesNeedingEnrichment();

  if (totalTitles === 0) {
    console.log(`\n✨ All titles already have TMDB metadata! Nothing to do.\n`);
    process.exit(0);
  }

  const totalBatches = Math.ceil(totalTitles / BATCH_SIZE);

  console.log(`\n📈 Enrichment Plan:`);
  console.log(`   - Total titles to process: ${totalTitles}`);
  console.log(`   - Batch size: ${BATCH_SIZE}`);
  console.log(`   - Total batches: ${totalBatches}`);
  console.log(`   - Rate limit: ${TMDB_DELAY_MS}ms between requests (2 req/sec)`);
  console.log(`   - Estimated time: ~${Math.ceil((totalTitles * TMDB_DELAY_MS) / 1000 / 60)} minutes\n`);
  console.log(`${"━".repeat(70)}\n`);

  const startTime = Date.now();
  const globalResults = {
    processed: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Process each batch sequentially
  for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
    const offset = (batchNum - 1) * BATCH_SIZE;
    const batchResults = await processBatch(batchNum, offset, BATCH_SIZE);

    // Accumulate results
    globalResults.processed += batchResults.processed;
    globalResults.success += batchResults.success;
    globalResults.skipped += batchResults.skipped;
    globalResults.failed += batchResults.failed;
    globalResults.errors.push(...batchResults.errors);

    // Show overall progress
    console.log(`\n📊 OVERALL PROGRESS: ${batchNum}/${totalBatches} batches completed`);
    console.log(`   Total Processed: ${globalResults.processed}/${totalTitles}`);
    console.log(`   Success: ${globalResults.success}`);
    console.log(`   Skipped: ${globalResults.skipped}`);
    console.log(`   Failed: ${globalResults.failed}\n`);

    // Small delay between batches
    if (batchNum < totalBatches) {
      console.log(`⏸️  Pausing 2 seconds before next batch...\n`);
      await sleep(2000);
    }
  }

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

  // Final summary
  console.log(`\n${"━".repeat(70)}`);
  console.log(`✨ ALL BATCHES COMPLETE`);
  console.log(`${"━".repeat(70)}`);
  console.log(`📊 Final Statistics:`);
  console.log(`   Total Processed: ${globalResults.processed}`);
  console.log(`   ✅ Successfully enriched: ${globalResults.success}`);
  console.log(`   ⏭️  Skipped (no data): ${globalResults.skipped}`);
  console.log(`   ❌ Failed: ${globalResults.failed}`);
  console.log(`   ⏱️  Duration: ${duration} minutes`);
  console.log(`${"━".repeat(70)}\n`);

  if (globalResults.errors.length > 0) {
    console.log(`\n❌ Errors encountered:`);
    globalResults.errors.forEach((err, idx) => {
      console.log(`   ${idx + 1}. ${err.title} (${err.id}): ${err.error}`);
    });
    console.log();
  }

  console.log(`\n✅ Metadata enrichment and embedding regeneration complete!\n`);
}

// Run if called directly
const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === __filename;

if (isMainModule) {
  main().catch((error) => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  });
}

export { enrichTitleWithMetadata, getTitlesNeedingTMDBEnrichment, countTitlesNeedingEnrichment };

