/**
 * Extract vibes, tone, and pacing from content using LLM
 */

import { chatCompletion, parseJsonResponse } from "./openai-client.js";
import {
  VIBE_DIMENSIONS,
  TONES,
  PACING,
  validateVibes,
  validateTone,
  validatePacing,
} from "../schema.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("[Vibes]");

const SYSTEM_PROMPT = `You are a film/TV analyst extracting emotional and atmospheric qualities from content.

Your task is to analyze the provided content and extract:
1. VIBES: Emotional/atmospheric qualities with intensity scores (0.0-1.0)
2. TONE: The overall tonal quality
3. PACING: The narrative pacing

IMPORTANT RULES:
- Only use vibes from this exact list: ${VIBE_DIMENSIONS.join(", ")}
- Only use tones from this exact list: ${TONES.join(", ")}
- Only use pacing from this exact list: ${PACING.join(", ")}
- Scores must be between 0.0 and 1.0
- Include 4-8 vibes that best describe the content
- Only include vibes with score >= 0.3

Respond with ONLY a JSON object in this exact format:
{
  "vibes": {
    "vibe_name": 0.85,
    "another_vibe": 0.70
  },
  "tone": "tone_name",
  "pacing": "pacing_name"
}`;

/**
 * Extract vibes, tone, and pacing from content
 * @param {string} content - Wikipedia content or overview
 * @param {string} title - Title of the movie/TV show
 * @param {"movie"|"tv"} kind
 * @returns {Promise<{vibes: Object, tone: string|null, pacing: string|null}>}
 */
export async function extractVibes(content, title, kind) {
  const contentSnippet = content?.slice(0, 3000) || "";

  const userPrompt = `Analyze this ${kind === "movie" ? "film" : "TV series"}:

Title: ${title}

Content:
${contentSnippet}

Extract the vibes, tone, and pacing.`;

  try {
    const response = await chatCompletion(SYSTEM_PROMPT, userPrompt);
    const parsed = parseJsonResponse(response);

    if (!parsed) {
      log.warn(`Failed to parse vibes response for: ${title}`);
      return { vibes: {}, tone: null, pacing: null };
    }

    // Validate against schema
    const vibes = validateVibes(parsed.vibes);
    const tone = validateTone(parsed.tone);
    const pacing = validatePacing(parsed.pacing);

    // Log validation results
    const originalVibeCount = Object.keys(parsed.vibes || {}).length;
    const validVibeCount = Object.keys(vibes).length;
    if (originalVibeCount !== validVibeCount) {
      log.debug(`Filtered vibes for ${title}: ${originalVibeCount} -> ${validVibeCount}`);
    }

    if (parsed.tone && !tone) {
      log.debug(`Invalid tone for ${title}: ${parsed.tone}`);
    }

    if (parsed.pacing && !pacing) {
      log.debug(`Invalid pacing for ${title}: ${parsed.pacing}`);
    }

    return { vibes, tone, pacing };
  } catch (error) {
    log.error(`Error extracting vibes for: ${title}`, { error: error.message });
    return { vibes: {}, tone: null, pacing: null };
  }
}

/**
 * Extract vibes from overview only (fallback when no Wikipedia content)
 * @param {string} overview - TMDB overview
 * @param {string} title - Title
 * @param {"movie"|"tv"} kind
 * @param {string[]} genres - Genres for context
 * @returns {Promise<{vibes: Object, tone: string|null, pacing: string|null}>}
 */
export async function extractVibesFromOverview(overview, title, kind, genres = []) {
  const genreContext = genres.length > 0 ? `Genres: ${genres.join(", ")}\n` : "";

  const userPrompt = `Analyze this ${kind === "movie" ? "film" : "TV series"}:

Title: ${title}
${genreContext}
Overview:
${overview || "No overview available"}

Extract the vibes, tone, and pacing based on the available information.`;

  try {
    const response = await chatCompletion(SYSTEM_PROMPT, userPrompt);
    const parsed = parseJsonResponse(response);

    if (!parsed) {
      log.warn(`Failed to parse vibes response for: ${title}`);
      return { vibes: {}, tone: null, pacing: null };
    }

    return {
      vibes: validateVibes(parsed.vibes),
      tone: validateTone(parsed.tone),
      pacing: validatePacing(parsed.pacing),
    };
  } catch (error) {
    log.error(`Error extracting vibes from overview for: ${title}`, { error: error.message });
    return { vibes: {}, tone: null, pacing: null };
  }
}
