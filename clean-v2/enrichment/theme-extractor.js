/**
 * Extract themes from content using LLM
 */

import { chatCompletion, parseJsonResponse } from "./openai-client.js";
import { THEMES, validateThemes } from "../schema.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("[Themes]");

const SYSTEM_PROMPT = `You are a film/TV analyst extracting thematic elements from content.

Your task is to identify the main themes present in the content.

IMPORTANT RULES:
- Only use themes from this exact list: ${THEMES.join(", ")}
- Select 3-5 themes that best represent the content
- Order themes by relevance (most relevant first)

Respond with ONLY a JSON object in this exact format:
{
  "themes": ["theme1", "theme2", "theme3"]
}`;

/**
 * Extract themes from content
 * @param {string} content - Wikipedia content or overview
 * @param {string} title - Title of the movie/TV show
 * @returns {Promise<string[]>}
 */
export async function extractThemes(content, title) {
  const contentSnippet = content?.slice(0, 3000) || "";

  const userPrompt = `Analyze this content and identify the main themes:

Title: ${title}

Content:
${contentSnippet}

Extract the themes.`;

  try {
    const response = await chatCompletion(SYSTEM_PROMPT, userPrompt);
    const parsed = parseJsonResponse(response);

    if (!parsed || !Array.isArray(parsed.themes)) {
      log.warn(`Failed to parse themes response for: ${title}`);
      return [];
    }

    // Validate against schema
    const themes = validateThemes(parsed.themes);

    // Log validation results
    if (parsed.themes.length !== themes.length) {
      log.debug(`Filtered themes for ${title}: ${parsed.themes.length} -> ${themes.length}`);
    }

    return themes.slice(0, 5); // Max 5 themes
  } catch (error) {
    log.error(`Error extracting themes for: ${title}`, { error: error.message });
    return [];
  }
}

/**
 * Extract themes from overview only (fallback)
 * @param {string} overview - TMDB overview
 * @param {string} title - Title
 * @param {string[]} genres - Genres for context
 * @returns {Promise<string[]>}
 */
export async function extractThemesFromOverview(overview, title, genres = []) {
  const genreContext = genres.length > 0 ? `Genres: ${genres.join(", ")}\n` : "";

  const userPrompt = `Analyze this content and identify the main themes:

Title: ${title}
${genreContext}
Overview:
${overview || "No overview available"}

Extract the themes based on the available information.`;

  try {
    const response = await chatCompletion(SYSTEM_PROMPT, userPrompt);
    const parsed = parseJsonResponse(response);

    if (!parsed || !Array.isArray(parsed.themes)) {
      log.warn(`Failed to parse themes response for: ${title}`);
      return [];
    }

    return validateThemes(parsed.themes).slice(0, 5);
  } catch (error) {
    log.error(`Error extracting themes from overview for: ${title}`, { error: error.message });
    return [];
  }
}
