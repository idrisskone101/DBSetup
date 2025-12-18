/**
 * Build text inputs for embedding generation
 * Each embedding type uses different text to capture different aspects
 */

/**
 * Build text for vibe embedding
 * Captures: mood, atmosphere, emotional tone, energy level
 * @param {Object} title - Title object from database
 * @returns {string}
 */
export function buildVibeText(title) {
  const parts = [];

  // Vibes (with emphasis on compound phrases)
  if (title.vibes && typeof title.vibes === "object") {
    const vibeEntries = Object.entries(title.vibes)
      .filter(([, score]) => score >= 0.3)
      .sort((a, b) => b[1] - a[1]);

    const vibeStrings = vibeEntries.map(([vibe, score]) => {
      // Repeat high-scoring vibes for emphasis
      if (score >= 0.8) return `${vibe} ${vibe}`;
      return vibe;
    });

    if (vibeStrings.length > 0) {
      parts.push(`Vibes: ${vibeStrings.join(", ")}`);
    }
  }

  // Tone
  if (title.tone) {
    parts.push(`Tone: ${title.tone}`);
  }

  // Pacing
  if (title.pacing) {
    parts.push(`Pacing: ${title.pacing}`);
  }

  // Tagline (often captures emotional hook)
  if (title.tagline) {
    parts.push(`Tagline: ${title.tagline}`);
  }

  return parts.join("\n") || "No vibe information available";
}

/**
 * Build text for content embedding
 * Captures: plot, themes, story structure, narrative style
 * @param {Object} title - Title object from database
 * @returns {string}
 */
export function buildContentText(title) {
  const parts = [];

  // Profile string (primary - spoiler-free premise)
  if (title.profile_string) {
    parts.push(`Story: ${title.profile_string}`);
  }

  // Themes
  if (Array.isArray(title.themes) && title.themes.length > 0) {
    parts.push(`Themes: ${title.themes.join(", ")}`);
  }

  // Overview (if different from profile_string and adds value)
  if (title.overview && title.overview !== title.profile_string) {
    const overview = title.overview.slice(0, 500);
    parts.push(`Overview: ${overview}`);
  }

  // Keywords (top 15)
  if (Array.isArray(title.keywords) && title.keywords.length > 0) {
    const keywords = title.keywords.slice(0, 15);
    parts.push(`Keywords: ${keywords.join(", ")}`);
  }

  return parts.join("\n") || "No content information available";
}

/**
 * Build text for metadata embedding
 * Captures: genre conventions, style, era, quality signals
 * @param {Object} title - Title object from database
 * @returns {string}
 */
export function buildMetadataText(title) {
  const parts = [];

  // Type
  parts.push(`Type: ${title.kind === "movie" ? "film" : "television series"}`);

  // Genres 
  if (Array.isArray(title.genres) && title.genres.length > 0) {
    parts.push(`Genres: ${title.genres.join(", ")}`);
  }

  // Director or Creators
  if (title.director) {
    parts.push(`Director: ${title.director}`);
  } else if (Array.isArray(title.creators) && title.creators.length > 0) {
    parts.push(`Created by: ${title.creators.join(", ")}`);
  }

  // Writers (top 3)
  if (Array.isArray(title.writers) && title.writers.length > 0) {
    const writers = title.writers.slice(0, 3);
    parts.push(`Writers: ${writers.join(", ")}`);
  }

  // Certification
  if (title.certification) {
    parts.push(`Rating: ${title.certification}`);
  }

  // Production countries
  if (Array.isArray(title.production_countries) && title.production_countries.length > 0) {
    parts.push(`Countries: ${title.production_countries.join(", ")}`);
  }

  // Collection (franchise)
  if (title.collection_name) {
    parts.push(`Collection: ${title.collection_name}`);
  }

  // Year
  if (title.release_date) {
    const year = title.release_date.slice(0, 4);
    parts.push(`Released: ${year}`);
  }

  // Runtime
  if (title.runtime_minutes) {
    parts.push(`Runtime: ${title.runtime_minutes} minutes`);
  }

  return parts.join("\n") || "No metadata available";
}

/**
 * Build all three text inputs for a title
 * @param {Object} title - Title object from database
 * @returns {{vibe: string, content: string, metadata: string}}
 */
export function buildAllEmbeddingTexts(title) {
  return {
    vibe: buildVibeText(title),
    content: buildContentText(title),
    metadata: buildMetadataText(title),
  };
}
