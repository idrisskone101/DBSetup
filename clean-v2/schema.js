/**
 * Schema constants for vibes, tones, pacing, and themes
 * All LLM outputs MUST use values from these arrays
 */

export const VIBE_DIMENSIONS = [
  "cozy",
  "whimsical",
  "lighthearted",
  "romantic",
  "heartwarming",
  "sentimental",
  "earnest",
  "uplifting",
  "melancholic",
  "bittersweet",
  "somber",
  "brooding",
  "dark",
  "gritty",
  "noir",
  "atmospheric",
  "dreamy",
  "surreal",
  "trippy",
  "tense",
  "suspenseful",
  "thrilling",
  "intense",
  "chaotic",
  "kinetic",
  "energetic",
  "epic",
  "playful",
  "campy",
  "satirical",
  "absurdist",
  "comedic",
];

export const TONES = [
  "serious",
  "earnest",
  "hopeful",
  "bleak",
  "grim",
  "cynical",
  "optimistic",
  "playful",
  "humorous",
  "sarcastic",
  "satirical",
  "dramatic",
  "melancholic",
  "poetic",
  "noir",
  "whimsical",
  "philosophical",
  "intense",
];

export const PACING = [
  "ultra-slow",
  "slow-burn",
  "moderate",
  "fast-paced",
  "hyper-kinetic",
];

export const THEMES = [
  "identity",
  "self-discovery",
  "coming-of-age",
  "family",
  "friendship",
  "love",
  "forbidden love",
  "betrayal",
  "revenge",
  "redemption",
  "justice",
  "morality",
  "loyalty",
  "sacrifice",
  "courage",
  "greed",
  "power",
  "corruption",
  "oppression",
  "freedom",
  "survival",
  "fear",
  "hope",
  "grief",
  "loss",
  "trauma",
  "madness",
  "psychology",
  "fate",
  "destiny",
  "time",
  "memory",
  "technology",
  "human vs machine",
  "society",
  "class",
  "wealth",
  "poverty",
  "crime",
  "heist",
  "mystery",
  "investigation",
  "politics",
  "war",
  "environment",
  "nature",
  "exploration",
  "adventure",
  "fantasy",
  "magic",
  "mythology",
  "afterlife",
  "faith",
];

// Validation helpers
export function isValidVibe(vibe) {
  return VIBE_DIMENSIONS.includes(vibe);
}

export function isValidTone(tone) {
  return TONES.includes(tone);
}

export function isValidPacing(pacing) {
  return PACING.includes(pacing);
}

export function isValidTheme(theme) {
  return THEMES.includes(theme);
}

/**
 * Validate and filter vibes object to only include valid keys
 * @param {Object} vibes - Object with vibe keys and score values
 * @returns {Object} - Filtered object with only valid vibes
 */
export function validateVibes(vibes) {
  if (!vibes || typeof vibes !== "object") return {};

  const validated = {};
  for (const [key, value] of Object.entries(vibes)) {
    if (isValidVibe(key) && typeof value === "number" && value >= 0 && value <= 1) {
      validated[key] = Math.round(value * 100) / 100; // Round to 2 decimals
    }
  }
  return validated;
}

/**
 * Validate and filter themes array to only include valid themes
 * @param {string[]} themes - Array of theme strings
 * @returns {string[]} - Filtered array with only valid themes
 */
export function validateThemes(themes) {
  if (!Array.isArray(themes)) return [];
  return themes.filter(isValidTheme);
}

/**
 * Validate tone, return null if invalid
 * @param {string} tone - Tone string
 * @returns {string|null} - Valid tone or null
 */
export function validateTone(tone) {
  return isValidTone(tone) ? tone : null;
}

/**
 * Validate pacing, return null if invalid
 * @param {string} pacing - Pacing string
 * @returns {string|null} - Valid pacing or null
 */
export function validatePacing(pacing) {
  return isValidPacing(pacing) ? pacing : null;
}
