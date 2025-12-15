/**
 * TMDB data extractors
 * Clean functions to extract specific data from TMDB API responses
 */

// Standard genres mapping for normalization
const GENRE_MAPPING = {
  "science fiction": "science fiction",
  "sci-fi": "science fiction",
  "sci fi": "science fiction",
  "action & adventure": "action",
  "war & politics": "war",
  "soap opera": "drama",
  news: "documentary",
  talk: "documentary",
  reality: "reality",
};

/**
 * Extract top cast members
 * @param {Object} credits - Credits object from TMDB
 * @param {number} [limit=10] - Max cast members to return
 * @returns {Array<{name: string, character: string, order: number, profile_path: string|null}>}
 */
export function extractCast(credits, limit = 10) {
  if (!credits?.cast || !Array.isArray(credits.cast)) {
    return [];
  }

  return credits.cast.slice(0, limit).map((member) => ({
    name: member.name,
    character: member.character || null,
    order: member.order,
    profile_path: member.profile_path || null,
  }));
}

/**
 * Extract director from movie credits
 * @param {Object} credits - Credits object from TMDB
 * @returns {string|null}
 */
export function extractDirector(credits) {
  if (!credits?.crew || !Array.isArray(credits.crew)) {
    return null;
  }

  const director = credits.crew.find((member) => member.job === "Director");
  return director?.name || null;
}

/**
 * Extract creators for TV shows
 * @param {Object} tvData - TV show data from TMDB
 * @returns {string[]}
 */
export function extractCreators(tvData) {
  // Primary: created_by field
  if (tvData?.created_by && Array.isArray(tvData.created_by) && tvData.created_by.length > 0) {
    return tvData.created_by.map((c) => c.name);
  }

  // Fallback: Executive Producers from credits
  if (tvData?.credits?.crew) {
    const executives = tvData.credits.crew
      .filter((c) => c.job === "Executive Producer")
      .slice(0, 3)
      .map((c) => c.name);

    if (executives.length > 0) {
      return executives;
    }
  }

  return [];
}

/**
 * Extract writers from credits
 * @param {Object} credits - Credits object from TMDB
 * @param {number} [limit=5] - Max writers to return
 * @returns {string[]}
 */
export function extractWriters(credits, limit = 5) {
  if (!credits?.crew || !Array.isArray(credits.crew)) {
    return [];
  }

  const writerJobs = ["Screenplay", "Writer", "Story", "Teleplay", "Novel"];

  const writers = credits.crew
    .filter((member) => writerJobs.includes(member.job))
    .map((member) => member.name);

  // Deduplicate and limit
  return [...new Set(writers)].slice(0, limit);
}

/**
 * Extract keywords
 * @param {Object} keywordsData - Keywords object from TMDB (different structure for movies vs TV)
 * @returns {string[]}
 */
export function extractKeywords(keywordsData) {
  if (!keywordsData) return [];

  // Movies: keywords.keywords, TV: keywords.results
  const keywords = keywordsData.keywords || keywordsData.results || [];

  if (!Array.isArray(keywords)) return [];

  return keywords
    .map((k) => k.name)
    .filter((name) => name && name.length > 1) // Filter out single-char keywords
    .slice(0, 50);
}

/**
 * Normalize genres to standard list
 * @param {Array<{id: number, name: string}>} genres - Genres from TMDB
 * @returns {string[]}
 */
export function normalizeGenres(genres) {
  if (!Array.isArray(genres)) return [];

  const normalized = genres.map((g) => {
    const name = g.name.toLowerCase();
    return GENRE_MAPPING[name] || name;
  });

  // Deduplicate
  return [...new Set(normalized)];
}

/**
 * Extract certification (age rating)
 * @param {Object} data - Movie or TV data with release_dates or content_ratings
 * @param {"movie"|"tv"} kind
 * @returns {string|null}
 */
export function extractCertification(data, kind) {
  const regions = ["US", "GB", "CA"]; // Priority order

  if (kind === "movie") {
    const releaseDates = data?.release_dates?.results;
    if (!releaseDates) return null;

    for (const region of regions) {
      const release = releaseDates.find((r) => r.iso_3166_1 === region);
      if (release?.release_dates?.[0]?.certification) {
        return release.release_dates[0].certification;
      }
    }
  } else if (kind === "tv") {
    const contentRatings = data?.content_ratings?.results;
    if (!contentRatings) return null;

    for (const region of regions) {
      const rating = contentRatings.find((r) => r.iso_3166_1 === region);
      if (rating?.rating) {
        return rating.rating;
      }
    }
  }

  return null;
}

/**
 * Extract production countries
 * @param {Object} data - Movie or TV data
 * @returns {string[]}
 */
export function extractProductionCountries(data) {
  if (!data?.production_countries || !Array.isArray(data.production_countries)) {
    return [];
  }

  return data.production_countries.map((c) => c.iso_3166_1);
}

/**
 * Extract collection info (movies only)
 * @param {Object} data - Movie data
 * @returns {{id: number, name: string}|null}
 */
export function extractCollection(data) {
  if (!data?.belongs_to_collection) return null;

  return {
    id: data.belongs_to_collection.id,
    name: data.belongs_to_collection.name,
  };
}

/**
 * Extract all relevant data from TMDB response
 * @param {Object} data - Full TMDB response
 * @param {"movie"|"tv"} kind
 * @returns {Object}
 */
export function extractAllMetadata(data, kind) {
  if (!data) return null;

  const credits = kind === "tv" ? data.aggregate_credits || data.credits : data.credits;

  const extracted = {
    // Core info
    title: data.title || data.name,
    original_title: data.original_title || data.original_name,
    overview: data.overview || null,
    tagline: data.tagline || null,

    // Metadata
    release_date: data.release_date || data.first_air_date || null,
    popularity: data.popularity || null,
    vote_average: data.vote_average || null,
    vote_count: data.vote_count || null,
    runtime_minutes: data.runtime || (data.episode_run_time?.[0] || null),

    // Visual
    poster_path: data.poster_path || null,
    backdrop_path: data.backdrop_path || null,

    // People
    cast: extractCast(credits),
    director: kind === "movie" ? extractDirector(credits) : null,
    creators: kind === "tv" ? extractCreators(data) : null,
    writers: extractWriters(credits),

    // Classification
    genres: normalizeGenres(data.genres),
    keywords: extractKeywords(data.keywords),
    certification: extractCertification(data, kind),

    // Location
    production_countries: extractProductionCountries(data),

    // Collection (movies only)
    collection_id: kind === "movie" ? extractCollection(data)?.id || null : null,
    collection_name: kind === "movie" ? extractCollection(data)?.name || null : null,

    // External IDs
    imdb_id: data.imdb_id || data.external_ids?.imdb_id || null,

    // Store full payload for reference
    payload: data,
  };

  return extracted;
}
