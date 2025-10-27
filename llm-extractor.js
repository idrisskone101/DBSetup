// LLM-based metadata extraction for rich semantic understanding
// Extracts slots, themes, vibes, tone, and pacing using structured outputs
import OpenAI from "openai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * System prompt for extracting semantic metadata from Wikipedia content
 * Emphasis on descriptive, contextual language rather than generic terms
 */
const EXTRACTION_SYSTEM_PROMPT = `You are a film/TV metadata analyst extracting rich, semantic information from Wikipedia content.

Your task is to extract DESCRIPTIVE, CONTEXTUALIZED metadata. DO NOT over-simplify or atomize compound descriptors.

1. **SLOTS** (story structure elements):
   - setting_place: Specific location description (e.g., "neo-Tokyo, post-war megacity", "rural Midwest during the Dust Bowl")
   - setting_time: Time period (e.g., "2092", "1930s", "present day")
   - protagonist: Character role/type with descriptive adjectives (e.g., "disillusioned ex-cop", "ambitious young lawyer")
   - goal: What the protagonist wants to achieve
   - obstacle: What stands in their way (can be complex/multi-part)
   - stakes: What's at risk if they fail

2. **THEMES**: Full thematic phrases that capture nuance. BE SPECIFIC AND DESCRIPTIVE.

   ✅ GOOD EXAMPLES:
   - "corruption of power and moral decay"
   - "father-son reconciliation"
   - "consequences of unchecked ambition"
   - "surveillance state and loss of privacy"
   - "immigrant identity and cultural assimilation"
   - "toxic masculinity in corporate culture"

   ❌ BAD EXAMPLES (too generic/atomic):
   - "power" (too vague)
   - "family" (too broad)
   - "love" (meaningless without context)
   - "identity" (needs specificity)

   Extract 3-8 specific, descriptive themes. Avoid single-word themes unless truly justified.

3. **VIBES**: Atmospheric/tonal compound descriptors. KEEP MODIFIERS ATTACHED TO GENRES.

   ✅ GOOD EXAMPLES:
   - "dark comedy" (NOT "dark" + "comedy" separately!)
   - "psychological horror"
   - "whimsical fantasy adventure"
   - "gritty neo-noir thriller"
   - "melancholic coming-of-age drama"
   - "satirical sci-fi"
   - "body horror with dark humor"

   ❌ BAD EXAMPLES (over-atomized):
   - "dark", "comedy" (separately) → This breaks semantic binding!
   - "psychological", "horror" (separately) → Loses context!
   - "action" (too generic)
   - "drama" (meaningless alone)

   Extract 3-6 compound descriptors. Each vibe should be 2-4 words that capture a specific atmospheric quality.
   If the content is BOTH dark AND comedic, use "dark comedy" as ONE vibe, not two separate vibes.

4. **TONE**: Overall emotional tone (can be compound).
   - Examples: "darkly comedic", "melancholic and introspective", "cynically romantic", "earnestly hopeful"
   - Be descriptive: prefer "sardonic and biting" over just "cynical"

5. **PACING**: Narrative rhythm.
   - Standard: slow-burn, mid, kinetic
   - Descriptive alternatives: contemplative, frenetic, episodic, methodical, uneven with explosive climaxes

CRITICAL RULES:
- PRESERVE COMPOUND DESCRIPTORS: "dark comedy" is ONE vibe, not two
- KEEP CONTEXT: "psychological thriller" is different from "psychological" + "thriller" separately
- BE DESCRIPTIVE: "corruption of power" > "power"
- AVOID SINGLE-WORD THEMES unless they're truly specific (e.g., "revenge" is OK, but "family" needs context)
- DO NOT split compound vibes/themes into atomic tokens
- Return NULL only when information is completely absent
- DO make reasonable inferences from context
- Extract FULL DETAIL including plot elements

Return ONLY valid JSON matching this structure:
{
  "slots": {
    "setting_place": "string or null",
    "setting_time": "string or null",
    "protagonist": "string or null",
    "goal": "string or null",
    "obstacle": "string or null",
    "stakes": "string or null"
  },
  "tone": "string or null",
  "pacing": "string or null",
  "themes": ["array of 3-8 DESCRIPTIVE theme phrases"],
  "vibes": ["array of 3-6 COMPOUND vibe descriptors"]
}`;

/**
 * Extract semantic metadata from Wikipedia content using LLM
 * @param {string} wikiText - Combined Wikipedia summary and plot text
 * @param {Object} facts - Basic facts about the title (for context)
 * @returns {Promise<Object>} - Extracted metadata object
 */
export async function extractMetadata(wikiText, facts = {}) {
  if (!wikiText || wikiText.trim().length === 0) {
    console.warn("⚠️  No Wikipedia text provided for extraction");
    return createEmptyMetadata();
  }

  try {
    // Build context from facts
    const context = buildContextString(facts);
    const userPrompt = `${context}\n\nWikipedia Content:\n${wikiText}`;

    console.log(
      `🤖 Extracting metadata with LLM (${wikiText.length} chars of text)...`,
    );

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3, // Low temp for consistency, slight creativity
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content ?? "{}";
    const extracted = JSON.parse(content);

    // Validate and normalize the response
    const metadata = normalizeMetadata(extracted);

    console.log(`✅ Extracted metadata:`, {
      slots:
        Object.keys(metadata.slots).filter((k) => metadata.slots[k] !== null)
          .length + "/6 fields",
      themes: metadata.themes?.length || 0,
      vibes: metadata.vibes?.length || 0,
      tone: metadata.tone || "null",
      pacing: metadata.pacing || "null",
    });

    return metadata;
  } catch (error) {
    console.error(`❌ Error extracting metadata: ${error.message}`);
    return createEmptyMetadata();
  }
}

/**
 * Build context string from basic facts
 * @param {Object} facts - Title facts (title, year, genres, etc.)
 * @returns {string} - Formatted context string
 */
function buildContextString(facts) {
  const parts = [];

  if (facts.title) {
    parts.push(`Title: ${facts.title}`);
  }

  if (facts.year) {
    parts.push(`Year: ${facts.year}`);
  }

  if (facts.kind) {
    parts.push(`Type: ${facts.kind}`);
  }

  if (facts.genres && facts.genres.length > 0) {
    parts.push(`Genres: ${facts.genres.join(", ")}`);
  }

  if (facts.runtime_minutes) {
    parts.push(`Runtime: ${facts.runtime_minutes} minutes`);
  }

  return parts.length > 0 ? parts.join("\n") + "\n" : "";
}

/**
 * Normalize and validate extracted metadata
 * Ensures proper structure and types
 * @param {Object} extracted - Raw LLM response
 * @returns {Object} - Normalized metadata
 */
function normalizeMetadata(extracted) {
  const normalized = {
    slots: {
      setting_place: extracted.slots?.setting_place || null,
      setting_time: extracted.slots?.setting_time || null,
      protagonist: extracted.slots?.protagonist || null,
      goal: extracted.slots?.goal || null,
      obstacle: extracted.slots?.obstacle || null,
      stakes: extracted.slots?.stakes || null,
    },
    tone: extracted.tone || null,
    pacing: extracted.pacing || null,
    themes: Array.isArray(extracted.themes)
      ? extracted.themes.filter(Boolean)
      : [],
    vibes: Array.isArray(extracted.vibes)
      ? extracted.vibes.filter(Boolean)
      : [],
  };

  // Trim all string values
  Object.keys(normalized.slots).forEach((key) => {
    if (normalized.slots[key]) {
      normalized.slots[key] = normalized.slots[key].trim();
    }
  });

  if (normalized.tone) normalized.tone = normalized.tone.trim();
  if (normalized.pacing) normalized.pacing = normalized.pacing.trim();

  return normalized;
}

/**
 * Create empty metadata structure
 * Used as fallback when extraction fails
 * @returns {Object} - Empty metadata object
 */
function createEmptyMetadata() {
  return {
    slots: {
      setting_place: null,
      setting_time: null,
      protagonist: null,
      goal: null,
      obstacle: null,
      stakes: null,
    },
    tone: null,
    pacing: null,
    themes: [],
    vibes: [],
  };
}

/**
 * System prompt for inferring metadata from TMDB data when Wikipedia is unavailable
 * Uses genres, keywords, overview, and other structured data
 */
const TMDB_INFERENCE_SYSTEM_PROMPT = `You are a film/TV metadata analyst inferring rich semantic information from TMDB data.

You have NO plot details, but you DO have:
- Genres (e.g., ["Action", "Thriller"])
- Keywords (e.g., ["revenge", "betrayal", "mafia"])
- Overview (short TMDB synopsis, if available)
- Tagline (marketing one-liner, if available)

Your task is to infer DESCRIPTIVE, CONTEXTUALIZED metadata.

1. **VIBES**: Compound atmospheric descriptors. COMBINE modifiers with genres.

   ✅ GOOD INFERENCE:
   - Genres: ["Comedy", "Crime"] + Keywords: ["dark humor"] → Vibes: ["dark comedy", "crime caper"]
   - Genres: ["Horror", "Thriller"] + Keywords: ["psychological"] → Vibes: ["psychological horror"]
   - Genres: ["Action", "Sci-Fi"] → Vibes: ["high-octane sci-fi action", "futuristic thriller"]
   - Genres: ["Drama"] + Keywords: ["family", "emotional"] → Vibes: ["emotional family drama"]

   ❌ BAD INFERENCE (atomic):
   - "action" (too generic)
   - "dark", "comedy" (separately) → Should be "dark comedy"!
   - Just copying genre names

   Combine keywords + genres into 3-5 specific compound vibes (2-4 words each).

2. **THEMES**: Extract from keywords and overview. Use full phrases.

   ✅ GOOD INFERENCE:
   - Keywords: ["revenge", "betrayal", "mafia"] → Themes: ["vengeance and retribution", "betrayal within crime families"]
   - Keywords: ["father", "son", "reconciliation"] → Themes: ["father-son reconciliation"]
   - Overview mentions "struggling artist" → Theme: "pursuit of creative dreams"

   ❌ BAD INFERENCE:
   - "revenge" alone (needs context)
   - "family" (too broad)
   - "love" (meaningless)

   Extract 2-5 descriptive themes from keywords and overview.

3. **TONE**: Infer from genres and keywords (can be compound).
   - Horror + ["supernatural"] → "tense and eerie"
   - Comedy + Drama → "darkly comedic" or "comedic yet poignant"
   - Action + ["intense"] → "intense and relentless"

4. **PACING**: Infer from genre conventions.
   - Action/Thriller → "kinetic" or "fast-paced"
   - Drama/Mystery → "contemplative" or "slow-burn"
   - Horror → "slow-burn with sudden jolts"

CRITICAL RULES:
- DO NOT just copy genre names into vibes (transform + combine them)
- COMBINE keywords with genres for context: "revenge thriller", "family drama"
- USE keywords to inform themes: ["revenge", "betrayal"] → "cycle of revenge and betrayal"
- PRESERVE compound descriptors: never split "dark comedy" into ["dark", "comedy"]

Return ONLY valid JSON:
{
  "slots": {
    "setting_place": "infer from keywords/overview if possible, else null",
    "setting_time": "infer from keywords/overview/year if possible, else null",
    "protagonist": "infer from overview/cast if possible, else null",
    "goal": null,
    "obstacle": null,
    "stakes": null
  },
  "tone": "string (compound preferred)",
  "pacing": "string",
  "themes": ["array of 2-5 descriptive theme phrases based on keywords"],
  "vibes": ["array of 3-5 compound descriptive vibe strings"]
}`;

/**
 * Infer metadata from TMDB data when Wikipedia content is unavailable
 * Uses genres, keywords, overview, tagline, and cast/director
 * @param {Object} row - Full title row from Supabase (contains TMDB data)
 * @returns {Promise<Object>} - Inferred metadata object
 */
export async function inferMetadataFromTMDB(row) {
  try {
    // Build TMDB context for inference
    const tmdbData = {
      title: row.title,
      kind: row.kind,
      year: row.release_date ? row.release_date.slice(0, 4) : null,
      genres: row.genres || [],
      keywords: row.keywords || [],
      overview: row.overview || null,
      tagline: row.tagline || null,
      cast: row.cast ? row.cast.slice(0, 5).map((c) => c.name) : [],
      director: row.director || null,
      writers: row.writers || [],
    };

    // Validate we have enough data to make inferences
    if (
      tmdbData.genres.length === 0 &&
      tmdbData.keywords.length === 0 &&
      !tmdbData.overview
    ) {
      console.warn(
        "⚠️  Insufficient TMDB data for inference (no genres, keywords, or overview)",
      );
      return createEmptyMetadata();
    }

    console.log(
      `🤖 Inferring metadata from TMDB data (${tmdbData.genres.length} genres, ${tmdbData.keywords.length} keywords)...`,
    );

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: TMDB_INFERENCE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `TMDB Data:\n${JSON.stringify(tmdbData, null, 2)}`,
        },
      ],
      temperature: 0.4, // Moderate creativity for inference
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content ?? "{}";
    const inferred = JSON.parse(content);

    // Validate and normalize the response
    const metadata = normalizeMetadata(inferred);

    console.log(`✅ Inferred metadata from TMDB:`, {
      vibes: metadata.vibes?.length || 0,
      themes: metadata.themes?.length || 0,
      tone: metadata.tone || "null",
      pacing: metadata.pacing || "null",
    });

    return metadata;
  } catch (error) {
    console.error(`❌ Error inferring metadata from TMDB: ${error.message}`);
    return createEmptyMetadata();
  }
}

/**
 * Check if extracted metadata is high quality
 * Returns false if metadata appears generic or incomplete
 * @param {Object} metadata - Metadata object to validate
 * @param {Array} genres - Original genres for comparison
 * @returns {boolean} - True if metadata is high quality
 */
export function isMetadataHighQuality(metadata, genres = []) {
  if (!metadata) return false;

  // Must have vibes and tone at minimum
  if (!metadata.vibes || metadata.vibes.length === 0) {
    console.log("  ⚠️  Low quality: No vibes");
    return false;
  }

  if (!metadata.tone || metadata.tone.trim().length === 0) {
    console.log("  ⚠️  Low quality: No tone");
    return false;
  }

  // Check for generic vibes (just genre names)
  const genreLower = genres.map((g) => g.toLowerCase());
  const genericVibes = ["action", "drama", "comedy", "thriller", "horror"];

  const hasOnlyGenericVibes = metadata.vibes.every(
    (vibe) =>
      genericVibes.includes(vibe.toLowerCase()) ||
      genreLower.some((genre) => vibe.toLowerCase() === genre),
  );

  if (hasOnlyGenericVibes) {
    console.log("  ⚠️  Low quality: Vibes are just genre names");
    return false;
  }

  // Must have at least 2 vibes for richness
  if (metadata.vibes.length < 2) {
    console.log("  ⚠️  Low quality: Too few vibes (<2)");
    return false;
  }

  return true;
}
