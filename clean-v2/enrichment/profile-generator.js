/**
 * Generate profile_string (narrative summary) using LLM
 */

import { chatCompletion } from "./openai-client.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("[Profile]");

const SYSTEM_PROMPT = `You are a film/TV copywriter creating concise, evocative descriptions.

Your task is to write a profile_string - a short narrative summary that captures the essence of the content.

IMPORTANT RULES:
- Length: 100-200 characters (aim for ~150)
- Focus on the PREMISE, not the full plot
- NO spoilers
- NO character names (use roles like "a detective", "a young woman")
- Capture the mood and what makes it unique
- Write in present tense
- Make it engaging and hook-like

Examples of good profile strings:
- "A weary detective's final case spirals into obsession when a serial killer targets women who look like his daughter."
- "Two estranged sisters reunite at their childhood home, where buried secrets and a mysterious inheritance test their fragile bond."
- "In a dystopian future, a young rebel discovers she's the key to overthrowing a totalitarian regime—if she can survive the games."

Respond with ONLY the profile string, no quotes or additional text.`;

/**
 * Generate a profile string from content
 * @param {string} content - Wikipedia content
 * @param {string} title - Title
 * @param {string} overview - TMDB overview (fallback/supplement)
 * @returns {Promise<string|null>}
 */
export async function generateProfile(content, title, overview) {
  const contentSnippet = content?.slice(0, 2000) || overview || "";

  if (!contentSnippet) {
    log.warn(`No content to generate profile for: ${title}`);
    return null;
  }

  const userPrompt = `Write a profile string for:

Title: ${title}

Content:
${contentSnippet}`;

  try {
    const response = await chatCompletion(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.5,
      maxTokens: 200,
    });

    // Clean up response
    let profile = response.trim();

    // Remove quotes if present
    if ((profile.startsWith('"') && profile.endsWith('"')) ||
        (profile.startsWith("'") && profile.endsWith("'"))) {
      profile = profile.slice(1, -1);
    }

    // Validate length
    if (profile.length < 50) {
      log.warn(`Profile too short for ${title}: ${profile.length} chars`);
      return null;
    }

    if (profile.length > 300) {
      log.debug(`Truncating profile for ${title}: ${profile.length} -> 250 chars`);
      profile = profile.slice(0, 247) + "...";
    }

    return profile;
  } catch (error) {
    log.error(`Error generating profile for: ${title}`, { error: error.message });
    return null;
  }
}

/**
 * Generate a profile string from overview only (fallback)
 * @param {string} overview - TMDB overview
 * @param {string} title - Title
 * @param {string[]} genres - Genres for context
 * @returns {Promise<string|null>}
 */
export async function generateProfileFromOverview(overview, title, genres = []) {
  if (!overview) {
    return null;
  }

  const genreContext = genres.length > 0 ? `Genres: ${genres.join(", ")}\n` : "";

  const userPrompt = `Write a profile string for:

Title: ${title}
${genreContext}
Overview:
${overview}`;

  try {
    const response = await chatCompletion(SYSTEM_PROMPT, userPrompt, {
      temperature: 0.5,
      maxTokens: 200,
    });

    let profile = response.trim();

    if ((profile.startsWith('"') && profile.endsWith('"')) ||
        (profile.startsWith("'") && profile.endsWith("'"))) {
      profile = profile.slice(1, -1);
    }

    if (profile.length < 50 || profile.length > 300) {
      return overview.slice(0, 200); // Fallback to overview
    }

    return profile;
  } catch (error) {
    log.error(`Error generating profile from overview for: ${title}`, { error: error.message });
    return overview?.slice(0, 200) || null;
  }
}
