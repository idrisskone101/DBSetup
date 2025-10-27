// Conservative fallback metadata based on genres, era, and content type
// Used when Wikipedia, TMDB overview, and LLM inference all fail

/**
 * Genre-based default metadata
 * Maps TMDB genres to sensible vibes, tone, and pacing
 */
const GENRE_DEFAULTS = {
  Action: {
    vibes: ["high-octane action", "adrenaline-fueled"],
    tone: "intense",
    pacing: "kinetic",
  },
  Adventure: {
    vibes: ["epic journey", "adventurous"],
    tone: "hopeful",
    pacing: "mid",
  },
  Animation: {
    vibes: ["animated fantasy", "whimsical"],
    tone: "lighthearted",
    pacing: "mid",
  },
  Comedy: {
    vibes: ["lighthearted comedy", "humorous"],
    tone: "comedic",
    pacing: "brisk",
  },
  Crime: {
    vibes: ["crime thriller", "gritty underworld"],
    tone: "gritty",
    pacing: "mid",
  },
  Documentary: {
    vibes: ["documentary realism", "educational"],
    tone: "earnest",
    pacing: "contemplative",
  },
  Drama: {
    vibes: ["emotional drama", "character-driven"],
    tone: "earnest",
    pacing: "contemplative",
  },
  Family: {
    vibes: ["family-friendly", "heartwarming"],
    tone: "wholesome",
    pacing: "mid",
  },
  Fantasy: {
    vibes: ["magical fantasy", "otherworldly"],
    tone: "whimsical",
    pacing: "mid",
  },
  History: {
    vibes: ["historical epic", "period piece"],
    tone: "earnest",
    pacing: "contemplative",
  },
  Horror: {
    vibes: ["suspenseful horror", "eerie"],
    tone: "tense",
    pacing: "slow-burn",
  },
  Music: {
    vibes: ["musical journey", "rhythmic"],
    tone: "uplifting",
    pacing: "brisk",
  },
  Mystery: {
    vibes: ["mystery thriller", "enigmatic"],
    tone: "suspenseful",
    pacing: "methodical",
  },
  Romance: {
    vibes: ["romantic drama", "heartfelt"],
    tone: "romantic",
    pacing: "mid",
  },
  "Science Fiction": {
    vibes: ["sci-fi adventure", "futuristic"],
    tone: "speculative",
    pacing: "mid",
  },
  "TV Movie": {
    vibes: ["made-for-TV drama"],
    tone: "earnest",
    pacing: "mid",
  },
  Thriller: {
    vibes: ["edge-of-your-seat thriller", "tense"],
    tone: "suspenseful",
    pacing: "kinetic",
  },
  War: {
    vibes: ["war epic", "military action"],
    tone: "gritty",
    pacing: "mid",
  },
  Western: {
    vibes: ["Western frontier", "dusty plains"],
    tone: "rugged",
    pacing: "contemplative",
  },
};

/**
 * Era-based tone modifiers
 * Older content tends to have different tones
 */
function getEraToneModifier(year) {
  if (!year) return null;

  const yearNum = parseInt(year, 10);

  if (yearNum < 1960) {
    return "classic and earnest";
  } else if (yearNum < 1980) {
    return "retro";
  } else if (yearNum < 2000) {
    return "nostalgic";
  }

  return null; // Modern content uses genre default
}

/**
 * Content type (TV vs Movie) pacing modifiers
 */
function getKindPacingModifier(kind) {
  if (kind === "tv") {
    // TV shows tend to be episodic
    return "episodic";
  }

  return null; // Movies use genre default
}

/**
 * Generate default metadata from genres, kind, and year
 * @param {Array} genres - Array of genre strings (e.g., ["Action", "Thriller"])
 * @param {string} kind - 'movie' or 'tv'
 * @param {string} year - Release year (optional)
 * @returns {Object} Default metadata { vibes, tone, pacing, themes }
 */
export function getDefaultMetadata(genres = [], kind = null, year = null) {
  // If no genres, return minimal defaults
  if (!genres || genres.length === 0) {
    return {
      vibes: kind === "tv" ? ["TV series"] : ["film"],
      tone: "earnest",
      pacing: kind === "tv" ? "episodic" : "mid",
      themes: [],
    };
  }

  // Get primary genre (first in list, usually most relevant)
  const primaryGenre = genres[0];
  const defaults = GENRE_DEFAULTS[primaryGenre] || {
    vibes: ["drama"],
    tone: "earnest",
    pacing: "mid",
  };

  // Merge vibes from multiple genres (max 4 vibes)
  const allVibes = [];
  for (const genre of genres.slice(0, 3)) {
    // Top 3 genres
    const genreDefaults = GENRE_DEFAULTS[genre];
    if (genreDefaults && genreDefaults.vibes) {
      allVibes.push(...genreDefaults.vibes);
    }
  }

  // De-duplicate vibes and limit to 4
  const uniqueVibes = [...new Set(allVibes)].slice(0, 4);

  // Apply era modifier to tone
  const eraTone = getEraToneModifier(year);
  const tone = eraTone || defaults.tone;

  // Apply kind modifier to pacing
  const kindPacing = getKindPacingModifier(kind);
  const pacing = kindPacing || defaults.pacing;

  // Generate basic themes from genres
  const themes = genres.map((genre) => genre.toLowerCase()).slice(0, 3);

  return {
    vibes: uniqueVibes.length > 0 ? uniqueVibes : defaults.vibes,
    tone,
    pacing,
    themes,
  };
}

/**
 * Check if metadata is "generic" (just defaults, no real extraction)
 * @param {Object} metadata - Metadata object
 * @param {Array} genres - Original genres
 * @returns {boolean} True if metadata appears to be generic/default
 */
export function isGenericMetadata(metadata, genres = []) {
  if (!metadata) return true;

  // If no vibes, it's generic
  if (!metadata.vibes || metadata.vibes.length === 0) {
    return true;
  }

  // Check if vibes are just the genre names (lazy extraction)
  const genreLower = genres.map((g) => g.toLowerCase());
  const vibesAreJustGenres = metadata.vibes.every((vibe) =>
    genreLower.some((genre) => vibe.toLowerCase().includes(genre)),
  );

  if (vibesAreJustGenres) {
    return true;
  }

  // Check for common generic vibes
  const genericVibes = [
    "action",
    "drama",
    "comedy",
    "thriller",
    "horror",
    "romance",
  ];
  const hasOnlyGenericVibes = metadata.vibes.every((vibe) =>
    genericVibes.includes(vibe.toLowerCase()),
  );

  return hasOnlyGenericVibes;
}
