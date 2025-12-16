/**
 * Extract story structure slots from content using LLM
 */

import { chatCompletion, parseJsonResponse } from "./openai-client.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("[Slots]");

const SYSTEM_PROMPT = `You are a film/TV story analyst extracting narrative structure elements.

Your task is to analyze the provided content and extract story structure "slots":
1. protagonist: Who is the main character/group? (e.g., "a young wizard", "the Stark family")
2. goal: What does the protagonist want? Start with "to" (e.g., "to save the world")
3. obstacle: What stands in their way? (e.g., "a corrupt government", "personal trauma")
4. stakes: What's at risk? (e.g., "the fate of humanity", "their family's legacy")
5. setting_time: When does it take place? (e.g., "1990s", "present day", "medieval times")
6. setting_place: Where does it take place? (e.g., "New York City", "a dystopian future Earth")

IMPORTANT RULES:
- Be concise but descriptive
- Use lowercase for values
- For protagonist, use generic descriptions (not character names)
- For goal, always start with "to"
- If information is not available, use null
- Focus on the main story, not subplots

Respond with ONLY a JSON object in this exact format:
{
  "protagonist": "string or null",
  "goal": "string or null",
  "obstacle": "string or null",
  "stakes": "string or null",
  "setting_time": "string or null",
  "setting_place": "string or null"
}`;

/**
 * Validate and clean slots object
 * @param {Object} slots - Raw slots from LLM
 * @returns {Object} - Cleaned slots
 */
function validateSlots(slots) {
  if (!slots || typeof slots !== "object") {
    return null;
  }

  const validKeys = ["protagonist", "goal", "obstacle", "stakes", "setting_time", "setting_place"];
  const result = {};

  for (const key of validKeys) {
    const value = slots[key];
    if (value && typeof value === "string" && value.trim().length > 0) {
      result[key] = value.trim().toLowerCase();
    } else {
      result[key] = null;
    }
  }

  // Check if at least some slots are populated
  const populatedCount = Object.values(result).filter((v) => v !== null).length;
  if (populatedCount < 2) {
    return null;
  }

  return result;
}

/**
 * Extract slots from content
 * @param {string} content - Wikipedia content
 * @param {string} title - Title of the movie/TV show
 * @param {"movie"|"tv"} kind
 * @returns {Promise<Object|null>}
 */
export async function extractSlots(content, title, kind) {
  const contentSnippet = content?.slice(0, 3000) || "";

  if (!contentSnippet) {
    log.warn(`No content to extract slots for: ${title}`);
    return null;
  }

  const userPrompt = `Analyze this ${kind === "movie" ? "film" : "TV series"}:

Title: ${title}

Content:
${contentSnippet}

Extract the story structure slots.`;

  try {
    const response = await chatCompletion(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.3,
      maxTokens: 500,
    });
    const parsed = parseJsonResponse(response);

    if (!parsed) {
      log.warn(`Failed to parse slots response for: ${title}`);
      return null;
    }

    const slots = validateSlots(parsed);
    if (!slots) {
      log.warn(`Invalid slots for: ${title}`);
      return null;
    }

    return slots;
  } catch (error) {
    log.error(`Error extracting slots for: ${title}`, { error: error.message });
    return null;
  }
}

/**
 * Extract slots from overview only (fallback when no Wikipedia content)
 * @param {string} overview - TMDB overview
 * @param {string} title - Title
 * @param {string[]} genres - Genres for context
 * @returns {Promise<Object|null>}
 */
export async function extractSlotsFromOverview(overview, title, genres = []) {
  if (!overview) {
    return null;
  }

  const genreContext = genres.length > 0 ? `Genres: ${genres.join(", ")}\n` : "";

  const userPrompt = `Analyze this film/TV series:

Title: ${title}
${genreContext}
Overview:
${overview}

Extract the story structure slots based on the available information. Use null for any slots that cannot be determined from the overview.`;

  try {
    const response = await chatCompletion(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.3,
      maxTokens: 500,
    });
    const parsed = parseJsonResponse(response);

    if (!parsed) {
      log.warn(`Failed to parse slots response for: ${title}`);
      return null;
    }

    return validateSlots(parsed);
  } catch (error) {
    log.error(`Error extracting slots from overview for: ${title}`, { error: error.message });
    return null;
  }
}
