// Wikipedia enrichment with LLM-based metadata extraction
// Exports functions for use by run-enrichment.js
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import dotenv from "dotenv";
import { getWikiContent } from "./wikipedia-fetcher.js";
import {
  extractMetadata,
  inferMetadataFromTMDB,
  isMetadataHighQuality,
} from "./llm-extractor.js";
import { synthesizeProfile } from "./llm-profile-synthesizer.js";
import { getDefaultMetadata } from "./conservative-defaults.js";

dotenv.config();

// Extract Supabase URL from DATABASE_URL
const databaseUrl = process.env.DATABASE_URL;
const match = databaseUrl.match(/db\.([^.]+)\.supabase\.co/);
if (!match) {
  throw new Error("Could not parse Supabase project ref from DATABASE_URL");
}
const projectRef = match[1];
const supabaseUrl = `https://${projectRef}.supabase.co`;

export const supabase = createClient(
  supabaseUrl,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Enrich a single title row with Wikipedia data and LLM-generated metadata
 * Implements 4-tier fallback chain for maximum data coverage
 * @param {Object} row - Title row from Supabase
 * @returns {Promise<Object>} Result object with success/error info
 */
export async function enrichTitleRow(row) {
  console.log(
    `\n📚 Enriching: ${row.title} (ID: ${row.id}, Kind: ${row.kind})`,
  );

  let metadata = null;
  let enrichmentMethod = "unknown";
  let wikiSourceUrl = null;

  try {
    const year = row.release_date ? row.release_date.slice(0, 4) : null;
    const facts = {
      title: row.title,
      year: year || "unknown",
      genres: row.genres || [],
      kind: row.kind,
    };

    // ========== TIER 1: Wikipedia Content ==========
    console.log(`  📖 [Tier 1] Attempting Wikipedia fetch...`);
    const { summary, plot, foundTitle } = await getWikiContent(row.title, {
      year,
      kind: row.kind,
    });

    let wikiText = [summary, plot].filter(Boolean).join("\n\n");

    if (wikiText.length >= 400) {
      // Good Wikipedia content - extract metadata
      console.log(`  ✅ [Tier 1] Wikipedia content (${wikiText.length} chars)`);
      wikiSourceUrl = foundTitle
        ? `https://en.wikipedia.org/wiki/${encodeURIComponent(foundTitle.replace(/ /g, "_"))}`
        : null;

      metadata = await extractMetadata(wikiText, facts);

      if (metadata && isMetadataHighQuality(metadata, row.genres || [])) {
        enrichmentMethod = "wikipedia";
        console.log(`  ✅ [Tier 1] High-quality metadata from Wikipedia`);
      } else {
        console.log(
          `  ⚠️  [Tier 1] Wikipedia metadata low quality, trying next tier...`,
        );
        metadata = null; // Reset for next tier
      }
    } else if (wikiText.length > 0) {
      console.log(
        `  ⚠️  [Tier 1] Wikipedia content too short (${wikiText.length} chars)`,
      );
    } else {
      console.log(`  ⚠️  [Tier 1] No Wikipedia content found`);
    }

    // ========== TIER 2: TMDB Overview + LLM Extraction ==========
    if (!metadata && row.overview && row.overview.length >= 100) {
      console.log(
        `  📝 [Tier 2] Attempting TMDB overview extraction (${row.overview.length} chars)...`,
      );

      metadata = await extractMetadata(row.overview, facts);

      if (metadata && isMetadataHighQuality(metadata, row.genres || [])) {
        enrichmentMethod = "tmdb_overview";
        console.log(`  ✅ [Tier 2] High-quality metadata from TMDB overview`);
      } else {
        console.log(
          `  ⚠️  [Tier 2] TMDB overview metadata low quality, trying next tier...`,
        );
        metadata = null; // Reset for next tier
      }
    } else if (!metadata) {
      console.log(
        `  ⚠️  [Tier 2] TMDB overview unavailable or too short (${row.overview?.length || 0} chars)`,
      );
    }

    // ========== TIER 3: TMDB Structured Data Inference ==========
    if (!metadata) {
      console.log(
        `  🔍 [Tier 3] Attempting TMDB inference from genres/keywords...`,
      );

      metadata = await inferMetadataFromTMDB(row);

      if (metadata && isMetadataHighQuality(metadata, row.genres || [])) {
        enrichmentMethod = "tmdb_inference";
        console.log(
          `  ✅ [Tier 3] Metadata inferred from TMDB structured data`,
        );
      } else {
        console.log(
          `  ⚠️  [Tier 3] TMDB inference produced low quality, using defaults...`,
        );
        metadata = null; // Reset for next tier
      }
    }

    // ========== TIER 4: Conservative Genre-Based Defaults ==========
    if (!metadata) {
      console.log(`  🎲 [Tier 4] Using conservative genre-based defaults...`);

      const defaults = getDefaultMetadata(row.genres || [], row.kind, year);

      metadata = {
        slots: {
          setting_place: null,
          setting_time: null,
          protagonist: null,
          goal: null,
          obstacle: null,
          stakes: null,
        },
        themes: defaults.themes,
        vibes: defaults.vibes,
        tone: defaults.tone,
        pacing: defaults.pacing,
      };

      enrichmentMethod = "defaults";
      console.log(`  ✅ [Tier 4] Applied conservative defaults`);
    }

    // ========== Validate Final Metadata ==========
    if (!metadata) {
      console.log(`  ❌ All enrichment tiers failed`);
      return {
        success: false,
        id: row.id,
        title: row.title,
        error: "All enrichment methods failed",
        method: "none",
      };
    }

    console.log(`  📊 Final metadata (method: ${enrichmentMethod}):`);
    console.log(`     Themes: ${metadata.themes?.join(", ") || "none"}`);
    console.log(`     Vibes: ${metadata.vibes?.join(", ") || "none"}`);
    console.log(`     Tone: ${metadata.tone || "none"}`);
    console.log(`     Pacing: ${metadata.pacing || "none"}`);

    // ========== Synthesize Profile String ==========
    const profileString = await synthesizeProfile(facts, metadata);

    if (!profileString) {
      console.log(`  ⚠️  Could not synthesize profile, using fallback`);
    } else {
      console.log(`  ✅ Synthesized profile: "${profileString}"`);
    }

    // ========== Update Supabase ==========
    const updateData = {
      profile_string: profileString,
      themes: metadata.themes || null,
      vibes: metadata.vibes || null,
      tone: metadata.tone || null,
      pacing: metadata.pacing || null,
      slots: metadata.slots || null,
      wiki_source_url: wikiSourceUrl,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("titles")
      .update(updateData)
      .eq("id", row.id);

    if (updateError) {
      throw new Error(`Supabase update failed: ${updateError.message}`);
    }

    console.log(`  ✅ Updated in database`);

    return {
      success: true,
      id: row.id,
      title: row.title,
      profile_string: profileString,
      themes: metadata.themes,
      vibes: metadata.vibes,
      method: enrichmentMethod,
    };
  } catch (error) {
    console.error(`  ❌ Error enriching ${row.title}:`, error.message);
    return {
      success: false,
      id: row.id,
      title: row.title,
      error: error.message,
      method: "error",
    };
  }
}

/**
 * Enrich multiple titles with rate limiting
 * @param {Array} rows - Array of title rows from Supabase
 * @param {Object} options - Options for enrichment
 * @param {number} options.delayMs - Delay between requests (default 1500ms)
 * @returns {Promise<Object>} Summary of results
 */
export async function enrichTitles(rows, options = {}) {
  const { delayMs = 1500 } = options;

  const results = {
    total: rows.length,
    success: 0,
    failed: 0,
    errors: [],
    methods: {
      wikipedia: 0,
      tmdb_overview: 0,
      tmdb_inference: 0,
      defaults: 0,
      error: 0,
    },
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`\n[${i + 1}/${rows.length}]`);

    const result = await enrichTitleRow(row);

    if (result.success) {
      results.success++;
      // Track which enrichment method was used
      if (result.method && results.methods[result.method] !== undefined) {
        results.methods[result.method]++;
      }
    } else {
      results.failed++;
      results.errors.push({
        id: result.id,
        title: result.title,
        error: result.error,
      });
      if (result.method === "error") {
        results.methods.error++;
      }
    }

    // Rate limiting - be respectful to Wikipedia and OpenAI APIs
    if (i < rows.length - 1) {
      console.log(`  ⏸️  Waiting ${delayMs}ms before next request...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
