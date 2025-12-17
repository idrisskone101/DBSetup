/**
 * Repair Status Report
 * Shows repair queue status and field breakdown
 */

import "dotenv/config";
import { getSupabase } from "../lib/supabase.js";

/**
 * Format number with commas
 */
function formatNumber(n) {
  return n.toLocaleString();
}

/**
 * Get TMDB repair status counts
 */
async function getTMDBRepairStats() {
  const supabase = getSupabase();

  // Count by status
  const statuses = ["pending", "success", "not_found", "api_error", "no_data"];
  const counts = {};

  for (const status of statuses) {
    const { count } = await supabase
      .from("titles")
      .select("id", { count: "exact", head: true })
      .eq("tmdb_repair_status", status);
    counts[status] = count || 0;
  }

  // Count titles needing TMDB repair (overview is null)
  const { count: needsRepair } = await supabase
    .from("titles")
    .select("id", { count: "exact", head: true })
    .is("overview", null);

  // Count never attempted
  const { count: neverAttempted } = await supabase
    .from("titles")
    .select("id", { count: "exact", head: true })
    .is("overview", null)
    .is("tmdb_repair_status", null);

  return {
    ...counts,
    needsRepair: needsRepair || 0,
    neverAttempted: neverAttempted || 0,
  };
}

/**
 * Get enrichment repair status counts
 */
async function getEnrichmentRepairStats() {
  const supabase = getSupabase();

  // Count by status
  const statuses = ["pending", "success", "partial", "wiki_not_found", "llm_error", "validation_failed"];
  const counts = {};

  for (const status of statuses) {
    const { count } = await supabase
      .from("titles")
      .select("id", { count: "exact", head: true })
      .eq("enrichment_status", "enriched")
      .eq("enrichment_repair_status", status);
    counts[status] = count || 0;
  }

  // Count enriched titles needing repair (any enrichment field null)
  const { count: needsRepair } = await supabase
    .from("titles")
    .select("id", { count: "exact", head: true })
    .eq("enrichment_status", "enriched")
    .or(
      "vibes.is.null," +
      "themes.is.null," +
      "tone.is.null," +
      "pacing.is.null," +
      "profile_string.is.null," +
      "slots.is.null," +
      "vibe_embedding.is.null," +
      "content_embedding.is.null," +
      "metadata_embedding.is.null"
    );

  // Count never attempted
  const { count: neverAttempted } = await supabase
    .from("titles")
    .select("id", { count: "exact", head: true })
    .eq("enrichment_status", "enriched")
    .is("enrichment_repair_status", null)
    .or(
      "vibes.is.null," +
      "themes.is.null," +
      "profile_string.is.null," +
      "slots.is.null," +
      "vibe_embedding.is.null"
    );

  return {
    ...counts,
    needsRepair: needsRepair || 0,
    neverAttempted: neverAttempted || 0,
  };
}

/**
 * Get field-level breakdown
 */
async function getFieldBreakdown() {
  const supabase = getSupabase();

  const fields = [
    // TMDB fields
    { name: "overview", column: "overview" },
    { name: "tagline", column: "tagline" },
    { name: "director", column: "director", filter: { kind: "movie" } },
    { name: "creators", column: "creators", filter: { kind: "tv" } },
    { name: "cast", column: "cast" },
    { name: "keywords", column: "keywords" },
    { name: "certification", column: "certification" },
    { name: "runtime_minutes", column: "runtime_minutes" },
    // Enrichment fields
    { name: "vibes", column: "vibes", enrichedOnly: true },
    { name: "themes", column: "themes", enrichedOnly: true },
    { name: "tone", column: "tone", enrichedOnly: true },
    { name: "pacing", column: "pacing", enrichedOnly: true },
    { name: "profile_string", column: "profile_string", enrichedOnly: true },
    { name: "slots", column: "slots", enrichedOnly: true },
    { name: "wiki_source_url", column: "wiki_source_url", enrichedOnly: true },
    { name: "vibe_embedding", column: "vibe_embedding", enrichedOnly: true },
    { name: "content_embedding", column: "content_embedding", enrichedOnly: true },
    { name: "metadata_embedding", column: "metadata_embedding", enrichedOnly: true },
  ];

  const breakdown = {};

  for (const field of fields) {
    let query = supabase
      .from("titles")
      .select("id", { count: "exact", head: true })
      .is(field.column, null);

    if (field.filter?.kind) {
      query = query.eq("kind", field.filter.kind);
    }

    if (field.enrichedOnly) {
      query = query.eq("enrichment_status", "enriched");
    }

    const { count } = await query;
    breakdown[field.name] = count || 0;
  }

  return breakdown;
}

/**
 * Get total counts
 */
async function getTotalCounts() {
  const supabase = getSupabase();

  const { count: total } = await supabase
    .from("titles")
    .select("id", { count: "exact", head: true });

  const { count: movies } = await supabase
    .from("titles")
    .select("id", { count: "exact", head: true })
    .eq("kind", "movie");

  const { count: tv } = await supabase
    .from("titles")
    .select("id", { count: "exact", head: true })
    .eq("kind", "tv");

  const { count: enriched } = await supabase
    .from("titles")
    .select("id", { count: "exact", head: true })
    .eq("enrichment_status", "enriched");

  return { total: total || 0, movies: movies || 0, tv: tv || 0, enriched: enriched || 0 };
}

/**
 * Print status report
 */
async function run() {
  console.log("\nFetching repair status...\n");

  const [totals, tmdbStats, enrichmentStats, breakdown] = await Promise.all([
    getTotalCounts(),
    getTMDBRepairStats(),
    getEnrichmentRepairStats(),
    getFieldBreakdown(),
  ]);

  // Database overview
  console.log("=== Database Overview ===");
  console.log(`Total titles:     ${formatNumber(totals.total)}`);
  console.log(`  Movies:         ${formatNumber(totals.movies)}`);
  console.log(`  TV Shows:       ${formatNumber(totals.tv)}`);
  console.log(`Enriched:         ${formatNumber(totals.enriched)}`);
  console.log("");

  // TMDB repair status
  console.log("=== TMDB Repair Status ===");
  console.log(`Needs repair:     ${formatNumber(tmdbStats.needsRepair).padStart(8)}  (titles missing overview)`);
  console.log(`Never attempted:  ${formatNumber(tmdbStats.neverAttempted).padStart(8)}  (no repair status)`);
  console.log(`Success:          ${formatNumber(tmdbStats.success).padStart(8)}  (repaired)`);
  console.log(`Not Found:        ${formatNumber(tmdbStats.not_found).padStart(8)}  (deleted from TMDB)`);
  console.log(`API Error:        ${formatNumber(tmdbStats.api_error).padStart(8)}  (retry in 24h)`);
  console.log(`No Data:          ${formatNumber(tmdbStats.no_data).padStart(8)}  (TMDB has no data)`);
  console.log("");

  // Enrichment repair status
  console.log("=== Enrichment Repair Status ===");
  console.log(`Needs repair:     ${formatNumber(enrichmentStats.needsRepair).padStart(8)}  (enriched titles with missing fields)`);
  console.log(`Never attempted:  ${formatNumber(enrichmentStats.neverAttempted).padStart(8)}  (no repair status)`);
  console.log(`Success:          ${formatNumber(enrichmentStats.success).padStart(8)}  (fully repaired)`);
  console.log(`Partial:          ${formatNumber(enrichmentStats.partial).padStart(8)}  (some fields succeeded)`);
  console.log(`Wiki Not Found:   ${formatNumber(enrichmentStats.wiki_not_found).padStart(8)}  (no Wikipedia article)`);
  console.log(`LLM Error:        ${formatNumber(enrichmentStats.llm_error).padStart(8)}  (extraction failed)`);
  console.log(`Validation Failed:${formatNumber(enrichmentStats.validation_failed).padStart(8)}  (schema rejected output)`);
  console.log("");

  // Field breakdown
  console.log("=== Field Breakdown (Missing) ===");
  console.log("TMDB Fields:");
  console.log(`  overview:         ${formatNumber(breakdown.overview).padStart(8)}`);
  console.log(`  tagline:          ${formatNumber(breakdown.tagline).padStart(8)}`);
  console.log(`  director (movie): ${formatNumber(breakdown.director).padStart(8)}`);
  console.log(`  creators (tv):    ${formatNumber(breakdown.creators).padStart(8)}`);
  console.log(`  cast:             ${formatNumber(breakdown.cast).padStart(8)}`);
  console.log(`  keywords:         ${formatNumber(breakdown.keywords).padStart(8)}`);
  console.log(`  certification:    ${formatNumber(breakdown.certification).padStart(8)}`);
  console.log(`  runtime_minutes:  ${formatNumber(breakdown.runtime_minutes).padStart(8)}`);
  console.log("");
  console.log("Enrichment Fields (enriched titles only):");
  console.log(`  vibes:            ${formatNumber(breakdown.vibes).padStart(8)}`);
  console.log(`  themes:           ${formatNumber(breakdown.themes).padStart(8)}`);
  console.log(`  tone:             ${formatNumber(breakdown.tone).padStart(8)}`);
  console.log(`  pacing:           ${formatNumber(breakdown.pacing).padStart(8)}`);
  console.log(`  profile_string:   ${formatNumber(breakdown.profile_string).padStart(8)}`);
  console.log(`  slots:            ${formatNumber(breakdown.slots).padStart(8)}`);
  console.log(`  wiki_source_url:  ${formatNumber(breakdown.wiki_source_url).padStart(8)}`);
  console.log("");
  console.log("Embeddings (enriched titles only):");
  console.log(`  vibe_embedding:   ${formatNumber(breakdown.vibe_embedding).padStart(8)}`);
  console.log(`  content_embedding:${formatNumber(breakdown.content_embedding).padStart(8)}`);
  console.log(`  metadata_embedding:${formatNumber(breakdown.metadata_embedding).padStart(8)}`);
  console.log("");

  // Recommendations
  console.log("=== Recommendations ===");

  if (enrichmentStats.neverAttempted > 0) {
    const embedOnly = breakdown.vibe_embedding + breakdown.content_embedding + breakdown.metadata_embedding;
    if (embedOnly > 0 && embedOnly < enrichmentStats.needsRepair / 2) {
      console.log(`- Run --embeddings-only first (${formatNumber(embedOnly)} quick wins)`);
    }
  }

  if (tmdbStats.neverAttempted > 0) {
    console.log(`- Run repair-tmdb to fetch ${formatNumber(tmdbStats.neverAttempted)} missing overviews`);
  }

  if (enrichmentStats.neverAttempted > 0) {
    console.log(`- Run repair-enrichment to fix ${formatNumber(enrichmentStats.neverAttempted)} enriched titles`);
  }

  if (tmdbStats.api_error > 0) {
    console.log(`- Run repair-tmdb --retry-errors to retry ${formatNumber(tmdbStats.api_error)} failed API calls`);
  }

  if (enrichmentStats.partial > 0) {
    console.log(`- Run repair-enrichment --retry-partial to retry ${formatNumber(enrichmentStats.partial)} partial repairs`);
  }

  console.log("");
}

// Run the report
run().catch((err) => {
  console.error("Failed to generate status report:", err.message);
  process.exit(1);
});
