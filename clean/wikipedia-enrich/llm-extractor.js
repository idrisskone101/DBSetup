// LLM-based metadata extraction with strict schema enforcement
import OpenAI from "openai";
import dotenv from "dotenv";
import { VIBE_DIMENSIONS, TONES, PACING, THEMES } from "../schema.js";

// Load environment variables
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000,
  maxRetries: 2,
});

// Format lists for the prompt
const VIBES_LIST = VIBE_DIMENSIONS.map((v) => `"${v}"`).join(", ");
const TONES_LIST = TONES.map((t) => `"${t}"`).join(", ");
const PACING_LIST = PACING.map((p) => `"${p}"`).join(", ");
const THEMES_LIST = THEMES.map((t) => `"${t}"`).join(", ");

const EXTRACTION_SYSTEM_PROMPT = `You are a film/TV metadata analyst. Your task is to extract standardized metadata from Wikipedia content.

You MUST strictly adhere to the following controlled vocabularies. Do not invent new terms.

1. **VIBES**: Assign a relevance score (0.00 to 1.00) for EACH of the following vibes based on the content.
   - 0.00: Not present / Irrelevant
   - 1.00: Extremely dominant / Core to the identity
   
   Allowed values (you must score ALL of these): ${VIBES_LIST}

2. **TONE** (Select ONE best fit - REQUIRED, always provide a value):
   Allowed values: ${TONES_LIST}

3. **PACING** (Select ONE best fit - REQUIRED, always provide a value):
   Allowed values: ${PACING_LIST}

4. **THEMES** (Select up to 5 most relevant):
   Allowed values: ${THEMES_LIST}

Return ONLY valid JSON matching this structure:
{
  "vibes": {
    "vibe_name": 0.50,
    ... (Include a score for every vibe in the allowed list)
  },
  "tone": "string from allowed list (required)",
  "pacing": "string from allowed list (required)",
  "themes": ["theme1", "theme2", ...] // up to 5 themes, or empty array if none apply
}

If the content does not support a confident inference for a field, return 0.00 (for vibes) or [] (for themes). For tone and pacing, always make your best inference.
`;

/**
 * Create empty metadata structure with all vibes zeroed out
 * @returns {Object} - Empty metadata object
 */
export function createEmptyMetadata() {
  const vibes = {};
  for (const v of VIBE_DIMENSIONS) {
    vibes[v] = 0.00;
  }
  return {
    vibes,
    tone: "dramatic",      // Default fallback
    pacing: "moderate",    // Default fallback
    themes: []
  };
}

/**
 * Extract standardized metadata from Wikipedia content using LLM
 * @param {string} wikiText - Combined Wikipedia summary and plot text
 * @param {Object} facts - Basic facts about the title (for context)
 * @returns {Promise<Object>} - Extracted metadata object
 */
export async function extractStandardizedMetadata(wikiText, facts = {}) {
  if (!wikiText || wikiText.trim().length === 0) {
    return createEmptyMetadata();
  }

  try {
    const context = buildContextString(facts);
    const userPrompt = `${context}\n\nWikipedia Content:\n${wikiText}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1, // Low temp for strict adherence
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content ?? "{}";
    const extracted = JSON.parse(content);

    // Validate against schema
    return validateMetadata(extracted);
  } catch (error) {
    console.error(`❌ Error extracting metadata: ${error.message}`);
    return createEmptyMetadata();
  }
}

/**
 * Build context string from basic facts
 * @param {Object} facts - Title facts
 * @returns {string} - Formatted context string
 */
function buildContextString(facts) {
  const parts = [];
  if (facts.title) parts.push(`Title: ${facts.title}`);
  if (facts.year) parts.push(`Year: ${facts.year}`);
  if (facts.kind) parts.push(`Type: ${facts.kind}`);
  if (facts.genres && facts.genres.length > 0) {
    parts.push(`Genres: ${facts.genres.join(", ")}`);
  }
  return parts.length > 0 ? parts.join("\n") + "\n" : "";
}

/**
 * Validate extracted metadata against schema
 * @param {Object} data - Raw extracted data
 * @returns {Object} - Validated data
 */
function validateMetadata(data) {
  const validated = createEmptyMetadata(); // Start with defaults

  // Validate Vibes
  const rawVibes = (typeof data.vibes === 'object' && data.vibes !== null) ? data.vibes : {};
  
  for (const vibe of VIBE_DIMENSIONS) {
    let score = 0;
    
    if (vibe in rawVibes) {
      const val = parseFloat(rawVibes[vibe]);
      if (!isNaN(val)) {
        score = val;
      }
    }

    // Clamp score between 0 and 1
    score = Math.max(0, Math.min(1, score));
    
    // Ensure 2 decimal places
    validated.vibes[vibe] = Number(score.toFixed(2));
  }

  // Validate Tone (use extracted value if valid, otherwise keep default)
  if (data.tone && TONES.includes(data.tone)) {
    validated.tone = data.tone;
  }
  // validated.tone already has default "dramatic" from createEmptyMetadata()

  // Validate Pacing (use extracted value if valid, otherwise keep default)
  if (data.pacing && PACING.includes(data.pacing)) {
    validated.pacing = data.pacing;
  }
  // validated.pacing already has default "moderate" from createEmptyMetadata()

  // Validate Themes
  if (Array.isArray(data.themes)) {
    const validThemes = data.themes
      .filter((t) => typeof t === "string" && THEMES.includes(t))
      .slice(0, 5); // Limit to max 5 themes
    validated.themes = validThemes;
  }

  return validated;
}
