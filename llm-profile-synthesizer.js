// LLM-based profile synthesis from extracted slots
// Generates compelling one-sentence loglines from structured metadata
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * System prompt for synthesizing profile strings from slots
 * Currently focused on rich, detailed profiles (spoiler filtering can be added later for frontend)
 */
const SYNTHESIS_SYSTEM_PROMPT = `You write compelling one-sentence loglines for films and TV shows.

Given structured story slots and basic facts, create a single sentence (≤30 words) that captures:
- The setting (time/place)
- The protagonist
- The central conflict or journey
- A hint of the stakes

Style guidelines:
- Use concrete, evocative language
- Prefer active voice and strong verbs
- Include specific details from the slots
- Make it compelling and cinematic
- Keep it punchy and clear

Examples of good loglines:
- "A disillusioned ex-cop in 2092 neo-Tokyo searches for his missing partner while battling government surveillance and his own failing memory."
- "During the Dust Bowl, a desperate farmer turned astronaut must find a habitable planet to save his children and humanity's future."
- "In Victorian London, an ambitious detective races to stop a serial killer before the city descends into chaos."

Return ONLY valid JSON:
{
  "profile_string": "Your one-sentence logline here (≤30 words)"
}`;

/**
 * Synthesize a profile string from extracted metadata
 * @param {Object} facts - Basic facts (title, year, genres, runtime)
 * @param {Object} metadata - Extracted metadata (slots, themes, vibes, tone, pacing)
 * @returns {Promise<string>} - Synthesized profile string
 */
export async function synthesizeProfile(facts, metadata) {
  try {
    // Build structured input for synthesis
    const input = buildSynthesisInput(facts, metadata);

    console.log(`🤖 Synthesizing profile from slots...`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(input, null, 2) },
      ],
      temperature: 0.5, // Moderate creativity for compelling writing
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content ?? "{}";
    const result = JSON.parse(content);

    const profileString = result.profile_string?.trim() || null;

    // Validate word count
    if (profileString) {
      const wordCount = profileString.split(/\s+/).length;

      if (wordCount > 30) {
        console.warn(`⚠️  Profile exceeds 30 words (${wordCount}), attempting regeneration...`);
        // Try again with stricter prompt
        return await regenerateProfile(input);
      }

      console.log(`✅ Generated profile (${wordCount} words): "${profileString}"`);
    } else {
      console.warn(`⚠️  No profile generated, using fallback`);
      return createFallbackProfile(facts, metadata);
    }

    return profileString;
  } catch (error) {
    console.error(`❌ Error synthesizing profile: ${error.message}`);
    return createFallbackProfile(facts, metadata);
  }
}

/**
 * Build structured input for profile synthesis
 * @param {Object} facts - Basic facts
 * @param {Object} metadata - Extracted metadata
 * @returns {Object} - Structured input object
 */
function buildSynthesisInput(facts, metadata) {
  return {
    facts: {
      title: facts.title,
      year: facts.year,
      genres: facts.genres,
      kind: facts.kind,
    },
    slots: metadata.slots || {},
    themes: metadata.themes || [],
    vibes: metadata.vibes || [],
    tone: metadata.tone,
    pacing: metadata.pacing,
  };
}

/**
 * Regenerate profile with stricter word limit
 * @param {Object} input - Synthesis input
 * @returns {Promise<string>} - Regenerated profile string
 */
async function regenerateProfile(input) {
  const stricterPrompt = SYNTHESIS_SYSTEM_PROMPT + "\n\nIMPORTANT: Keep it under 30 words. Be concise.";

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: stricterPrompt },
        { role: "user", content: JSON.stringify(input, null, 2) },
      ],
      temperature: 0.3, // Lower temp for more controlled output
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content ?? "{}";
    const result = JSON.parse(content);
    const profileString = result.profile_string?.trim() || null;

    const wordCount = profileString ? profileString.split(/\s+/).length : 0;

    if (wordCount > 30) {
      console.warn(`⚠️  Second attempt still too long (${wordCount} words), using fallback`);
      return createFallbackProfile(input.facts, { slots: input.slots, themes: input.themes });
    }

    console.log(`✅ Regenerated profile (${wordCount} words): "${profileString}"`);
    return profileString;
  } catch (error) {
    console.error(`❌ Error regenerating profile: ${error.message}`);
    return createFallbackProfile(input.facts, { slots: input.slots, themes: input.themes });
  }
}

/**
 * Create simple fallback profile when LLM synthesis fails
 * @param {Object} facts - Basic facts
 * @param {Object} metadata - Extracted metadata
 * @returns {string} - Fallback profile string
 */
function createFallbackProfile(facts, metadata) {
  const parts = [];

  // Try to build from slots first
  const slots = metadata.slots || {};

  if (slots.protagonist && slots.goal) {
    parts.push(`${slots.protagonist} must ${slots.goal}`);

    if (slots.obstacle) {
      parts.push(`despite ${slots.obstacle}`);
    }
  } else if (slots.protagonist) {
    parts.push(`Follows ${slots.protagonist}`);

    if (slots.setting_place) {
      parts.push(`in ${slots.setting_place}`);
    }
  } else {
    // Last resort: use basic facts
    if (facts.title) {
      parts.push(facts.title);
    }

    if (facts.genres && facts.genres.length > 0) {
      parts.push(`is a ${facts.genres[0].toLowerCase()}`);
    }

    if (slots.setting_time) {
      parts.push(`set in ${slots.setting_time}`);
    }

    if (metadata.themes && metadata.themes.length > 0) {
      parts.push(`exploring ${metadata.themes[0]}`);
    }
  }

  const fallback = parts.join(" ").trim();
  console.log(`ℹ️  Using fallback profile: "${fallback}"`);

  return fallback || `${facts.title || "A story"} in the ${facts.genres?.[0] || "drama"} genre.`;
}
