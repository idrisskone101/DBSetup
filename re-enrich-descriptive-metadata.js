#!/usr/bin/env node
// Re-enrichment script to fix over-canonicalized vibes and themes
// Uses Supabase to query and update records with better descriptive metadata
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { enrichTitleRow } from "./enrich-titles.js";

dotenv.config();

// Extract Supabase URL from DATABASE_URL
const databaseUrl = process.env.DATABASE_URL;
const match = databaseUrl.match(/db\.([^.]+)\.supabase\.co/);
if (!match) {
  throw new Error("Could not parse Supabase project ref from DATABASE_URL");
}
const projectRef = match[1];
const supabaseUrl = `https://${projectRef}.supabase.co`;

const supabase = createClient(
  supabaseUrl,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Check if vibes are over-canonicalized (atomic tokens only)
 * @param {Array} vibes - Array of vibe strings
 * @returns {boolean} True if vibes appear over-canonicalized
 */
function isOverCanonicalizedVibes(vibes) {
  if (!vibes || vibes.length === 0) return true;

  // Check for atomic generic words that should be compound
  const atomicGeneric = [
    "dark",
    "light",
    "action",
    "drama",
    "comedy",
    "thriller",
    "horror",
    "psychological",
    "romantic",
    "adventure",
  ];

  // If all vibes are single atomic words from generic list, it's over-canonicalized
  const allAtomic = vibes.every((vibe) => {
    const words = vibe.split(/\s+/);
    return words.length === 1 && atomicGeneric.includes(vibe.toLowerCase());
  });

  return allAtomic;
}

/**
 * Check if themes are over-canonicalized (single words or too generic)
 * @param {Array} themes - Array of theme strings
 * @returns {boolean} True if themes appear over-canonicalized
 */
function isOverCanonicalizedThemes(themes) {
  if (!themes || themes.length === 0) return true;

  // Check for single-word generic themes
  const genericSingleWords = [
    "family",
    "love",
    "power",
    "identity",
    "friendship",
    "betrayal",
    "war",
    "violence",
    "death",
    "life",
  ];

  // If more than 50% of themes are single generic words, it's over-canonicalized
  const singleWordCount = themes.filter((theme) => {
    const words = theme.split(/\s+/);
    return words.length === 1 && genericSingleWords.includes(theme.toLowerCase());
  }).length;

  return singleWordCount > themes.length * 0.5;
}

/**
 * Calculate quality score for metadata
 * Higher score = better quality (more descriptive)
 * @param {Object} metadata - Metadata object with vibes, themes, etc.
 * @returns {number} Quality score (0-100)
 */
function calculateQualityScore(metadata) {
  let score = 0;

  if (!metadata) return 0;

  // Vibes quality (40 points max)
  if (metadata.vibes && metadata.vibes.length > 0) {
    const avgWords =
      metadata.vibes.reduce((sum, vibe) => sum + vibe.split(/\s+/).length, 0) /
      metadata.vibes.length;

    if (avgWords >= 2) score += 40; // Compound vibes
    else if (avgWords >= 1.5) score += 25; // Mix of compound and atomic
    else score += 10; // Mostly atomic

    // Bonus for having 3+ vibes
    if (metadata.vibes.length >= 3) score += 10;
  }

  // Themes quality (40 points max)
  if (metadata.themes && metadata.themes.length > 0) {
    const avgWords =
      metadata.themes.reduce(
        (sum, theme) => sum + theme.split(/\s+/).length,
        0
      ) / metadata.themes.length;

    if (avgWords >= 2.5) score += 40; // Descriptive phrases
    else if (avgWords >= 1.5) score += 25; // Mix
    else score += 10; // Mostly single words

    // Bonus for having 3+ themes
    if (metadata.themes.length >= 3) score += 10;
  }

  // Tone and pacing (5 points each)
  if (metadata.tone) score += 5;
  if (metadata.pacing) score += 5;

  return Math.min(score, 100);
}

/**
 * Main re-enrichment function
 * @param {Object} options - Options for re-enrichment
 * @param {number} options.limit - Max number of records to process
 * @param {boolean} options.dryRun - If true, only report what would be updated
 */
async function reEnrichDescriptiveMetadata(options = {}) {
  const { limit = 1000, dryRun = false } = options;

  console.log("\n🔍 Phase 1: Identifying over-canonicalized records...\n");

  // Query all titles
  const { data: titles, error } = await supabase
    .from("titles")
    .select("*")
    .limit(limit);

  if (error) {
    console.error("❌ Error fetching titles:", error.message);
    return;
  }

  console.log(`📊 Total titles fetched: ${titles.length}`);

  // Identify candidates for re-enrichment
  const candidates = titles.filter((title) => {
    const overCanonicalVibes = isOverCanonicalizedVibes(title.vibes);
    const overCanonicalThemes = isOverCanonicalizedThemes(title.themes);
    const currentScore = calculateQualityScore({
      vibes: title.vibes,
      themes: title.themes,
      tone: title.tone,
      pacing: title.pacing,
    });

    return (overCanonicalVibes || overCanonicalThemes) && currentScore < 60;
  });

  console.log(`\n📋 Candidates for re-enrichment: ${candidates.length}`);
  console.log(`   - Over-canonicalized vibes: ${candidates.filter((c) => isOverCanonicalizedVibes(c.vibes)).length}`);
  console.log(`   - Over-canonicalized themes: ${candidates.filter((c) => isOverCanonicalizedThemes(c.themes)).length}`);

  if (dryRun) {
    console.log("\n🔍 DRY RUN MODE - Showing sample candidates:\n");
    candidates.slice(0, 10).forEach((title) => {
      console.log(`\n📽️  ${title.title} (ID: ${title.id})`);
      console.log(`   Current vibes: ${title.vibes?.join(", ") || "none"}`);
      console.log(`   Current themes: ${title.themes?.slice(0, 3).join(", ") || "none"}...`);
      console.log(`   Quality score: ${calculateQualityScore({ vibes: title.vibes, themes: title.themes, tone: title.tone, pacing: title.pacing })}/100`);
    });
    console.log(`\n... and ${Math.max(0, candidates.length - 10)} more candidates`);
    console.log("\n✅ Dry run complete. Run without --dry-run to execute.");
    return;
  }

  // Prioritize by quality score (worst first) and Wikipedia availability
  candidates.sort((a, b) => {
    const scoreA = calculateQualityScore({
      vibes: a.vibes,
      themes: a.themes,
      tone: a.tone,
      pacing: a.pacing,
    });
    const scoreB = calculateQualityScore({
      vibes: b.vibes,
      themes: b.themes,
      tone: b.tone,
      pacing: b.pacing,
    });

    // Prefer titles with Wikipedia URLs (likely to have good content)
    if (a.wiki_source_url && !b.wiki_source_url) return -1;
    if (!a.wiki_source_url && b.wiki_source_url) return 1;

    // Then sort by score (lowest first)
    return scoreA - scoreB;
  });

  console.log("\n🚀 Phase 2: Re-enriching candidates...\n");

  const results = {
    total: candidates.length,
    success: 0,
    failed: 0,
    improved: 0,
    noChange: 0,
    errors: [],
  };

  for (let i = 0; i < candidates.length; i++) {
    const title = candidates[i];
    console.log(`\n[${i + 1}/${candidates.length}] Re-enriching: ${title.title}`);

    const oldScore = calculateQualityScore({
      vibes: title.vibes,
      themes: title.themes,
      tone: title.tone,
      pacing: title.pacing,
    });

    console.log(`   Old quality score: ${oldScore}/100`);
    console.log(`   Old vibes: ${title.vibes?.join(", ") || "none"}`);
    console.log(`   Old themes: ${title.themes?.slice(0, 3).join(", ") || "none"}...`);

    try {
      // Re-run enrichment with updated prompts
      const result = await enrichTitleRow(title);

      if (result.success) {
        // Fetch updated record to calculate new score
        const { data: updated } = await supabase
          .from("titles")
          .select("vibes, themes, tone, pacing")
          .eq("id", title.id)
          .single();

        const newScore = calculateQualityScore(updated);

        console.log(`   ✅ New quality score: ${newScore}/100`);
        console.log(`   New vibes: ${updated.vibes?.join(", ") || "none"}`);
        console.log(`   New themes: ${updated.themes?.slice(0, 3).join(", ") || "none"}...`);

        if (newScore > oldScore + 10) {
          console.log(`   🎉 IMPROVED by ${newScore - oldScore} points!`);
          results.improved++;
        } else {
          console.log(`   ⚠️  No significant improvement (${newScore - oldScore} points)`);
          results.noChange++;
        }

        results.success++;
      } else {
        console.log(`   ❌ Re-enrichment failed: ${result.error}`);
        results.failed++;
        results.errors.push({
          id: title.id,
          title: title.title,
          error: result.error,
        });
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      results.failed++;
      results.errors.push({
        id: title.id,
        title: title.title,
        error: error.message,
      });
    }

    // Rate limiting - be respectful to APIs
    if (i < candidates.length - 1) {
      const delay = 2000; // 2 seconds between requests
      console.log(`   ⏸️  Waiting ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  console.log("\n\n📊 Re-enrichment Summary:");
  console.log(`   Total processed: ${results.total}`);
  console.log(`   ✅ Success: ${results.success}`);
  console.log(`   🎉 Improved: ${results.improved}`);
  console.log(`   ⚠️  No change: ${results.noChange}`);
  console.log(`   ❌ Failed: ${results.failed}`);

  if (results.errors.length > 0) {
    console.log("\n❌ Errors:");
    results.errors.slice(0, 10).forEach((err) => {
      console.log(`   - ${err.title} (ID: ${err.id}): ${err.error}`);
    });
    if (results.errors.length > 10) {
      console.log(`   ... and ${results.errors.length - 10} more errors`);
    }
  }

  console.log("\n✅ Re-enrichment complete!");
}

// CLI execution
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1]) : 1000;

reEnrichDescriptiveMetadata({ limit, dryRun }).catch(console.error);
