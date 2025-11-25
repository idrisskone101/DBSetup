/**
 * TMDB Metadata Extractors
 * Improved extraction functions for all metadata fields from TMDB API responses
 */

import { normalizeGenre } from "../genre-standardizer.js";

/**
 * Extract top cast members from credits
 * @param {Object} credits - Credits object from TMDB API (can be credits or aggregate_credits)
 * @param {Object} options - Extraction options
 * @param {number} options.limit - Max number of cast members (default: 10)
 * @returns {Array<{name: string, character: string|null, order: number, profile_path: string|null}>}
 */
export function extractCast(credits, options = {}) {
  const { limit = 10 } = options;

  if (!credits) return [];

  // Handle both regular credits and aggregate_credits (TV)
  const castArray = credits.cast;
  if (!Array.isArray(castArray)) return [];

  return castArray.slice(0, limit).map((member, index) => ({
    name: member.name || "Unknown",
    // For aggregate_credits, character might be in roles array
    character: member.character || member.roles?.[0]?.character || null,
    order: member.order ?? index,
    profile_path: member.profile_path || null,
  }));
}

/**
 * Extract primary director from crew
 * For movies: looks for "Director" job
 * For TV: may not have a single director (returns null)
 * @param {Object} credits - Credits object from TMDB API
 * @returns {string|null} - Director name or null
 */
export function extractDirector(credits) {
  if (!credits?.crew || !Array.isArray(credits.crew)) return null;

  // Find director(s)
  const directors = credits.crew.filter(
    (member) => member.job === "Director" || member.department === "Directing"
  );

  if (directors.length === 0) return null;

  // Return primary director (first one found)
  return directors[0].name || null;
}

/**
 * Extract writers from crew with better job type handling
 * @param {Object} credits - Credits object from TMDB API
 * @param {Object} options - Extraction options
 * @param {number} options.limit - Max number of writers (default: 5)
 * @returns {string[]} - Array of writer names (deduplicated)
 */
export function extractWriters(credits, options = {}) {
  const { limit = 5 } = options;

  if (!credits?.crew || !Array.isArray(credits.crew)) return [];

  // Priority order for writing credits
  const writerJobs = [
    "Screenplay",
    "Writer",
    "Story",
    "Teleplay",
    "Original Story",
    "Novel",
    "Characters",
  ];

  const writers = credits.crew
    .filter(
      (member) =>
        writerJobs.includes(member.job) || member.department === "Writing"
    )
    .map((member) => member.name)
    .filter(Boolean);

  // Deduplicate and limit
  return [...new Set(writers)].slice(0, limit);
}

/**
 * Extract TV show creators
 * Falls back to executive producers if created_by is empty
 * @param {Object} detail - Full TV detail object from TMDB API
 * @returns {string[]} - Array of creator names
 */
export function extractCreators(detail) {
  if (!detail) return [];

  // Primary: created_by field
  if (Array.isArray(detail.created_by) && detail.created_by.length > 0) {
    return detail.created_by.map((creator) => creator.name).filter(Boolean);
  }

  // Fallback: Executive Producers from crew
  const credits = detail.aggregate_credits || detail.credits;
  if (credits?.crew && Array.isArray(credits.crew)) {
    const execProducers = credits.crew
      .filter((member) => member.job === "Executive Producer")
      .slice(0, 3)
      .map((member) => member.name)
      .filter(Boolean);

    if (execProducers.length > 0) {
      return [...new Set(execProducers)];
    }
  }

  return [];
}

/**
 * Extract keywords from TMDB detail
 * Handles both movie format (keywords.keywords) and TV format (keywords.results)
 * @param {Object} detail - Full detail object from TMDB API
 * @returns {string[]} - Array of keyword strings
 */
export function extractKeywords(detail) {
  if (!detail?.keywords) return [];

  // Movies use detail.keywords.keywords
  // TV shows use detail.keywords.results
  const keywordArray =
    detail.keywords.keywords || detail.keywords.results || [];

  if (!Array.isArray(keywordArray)) return [];

  return keywordArray
    .map((kw) => kw.name)
    .filter(Boolean)
    .filter((kw) => kw.length > 1); // Filter out single-character keywords
}

/**
 * Extract certification/age rating with multi-region fallback
 * @param {Object} detail - Full detail object from TMDB API
 * @param {string[]} regions - Regions to try in order (default: ['US', 'GB', 'CA'])
 * @returns {string|null} - Certification string or null
 */
export function extractCertification(detail, regions = ["US", "GB", "CA"]) {
  if (!detail) return null;

  // For movies: release_dates
  if (detail.release_dates?.results) {
    for (const region of regions) {
      const regionData = detail.release_dates.results.find(
        (r) => r.iso_3166_1 === region
      );
      if (regionData?.release_dates) {
        // Find the first release with a certification
        const withCert = regionData.release_dates.find((rd) => rd.certification);
        if (withCert?.certification) {
          return withCert.certification;
        }
      }
    }
  }

  // For TV: content_ratings
  if (detail.content_ratings?.results) {
    for (const region of regions) {
      const rating = detail.content_ratings.results.find(
        (r) => r.iso_3166_1 === region
      );
      if (rating?.rating) {
        return rating.rating;
      }
    }
  }

  return null;
}

/**
 * Extract production countries
 * @param {Object} detail - Full detail object from TMDB API
 * @returns {string[]} - Array of ISO 3166-1 country codes
 */
export function extractProductionCountries(detail) {
  if (!detail?.production_countries || !Array.isArray(detail.production_countries)) {
    return [];
  }

  return detail.production_countries
    .map((country) => country.iso_3166_1)
    .filter(Boolean);
}

/**
 * Extract collection/franchise info (movies only)
 * @param {Object} detail - Full movie detail object from TMDB API
 * @returns {{collection_id: number|null, collection_name: string|null}}
 */
export function extractCollection(detail) {
  if (!detail?.belongs_to_collection) {
    return { collection_id: null, collection_name: null };
  }

  return {
    collection_id: detail.belongs_to_collection.id || null,
    collection_name: detail.belongs_to_collection.name || null,
  };
}

/**
 * Extract tagline
 * @param {Object} detail - Full detail object from TMDB API
 * @returns {string|null} - Tagline or null
 */
export function extractTagline(detail) {
  if (!detail?.tagline || typeof detail.tagline !== "string") {
    return null;
  }
  return detail.tagline.trim() || null;
}

/**
 * Extract streaming providers/watch availability
 * @param {Object} detail - Full detail object from TMDB API
 * @param {string[]} regions - Regions to try (default: ['US', 'CA', 'GB'])
 * @returns {{region: string, flatrate: Array, rent: Array, buy: Array}|null}
 */
export function extractProviders(detail, regions = ["US", "CA", "GB"]) {
  if (!detail?.["watch/providers"]?.results) {
    return null;
  }

  const results = detail["watch/providers"].results;

  // Find first available region
  for (const region of regions) {
    const regionData = results[region];
    if (regionData) {
      const formatProvider = (p) => ({
        provider_id: p.provider_id,
        provider_name: p.provider_name,
        display_priority: p.display_priority,
      });

      return {
        region,
        flatrate: Array.isArray(regionData.flatrate)
          ? regionData.flatrate.map(formatProvider)
          : [],
        rent: Array.isArray(regionData.rent)
          ? regionData.rent.map(formatProvider)
          : [],
        buy: Array.isArray(regionData.buy)
          ? regionData.buy.map(formatProvider)
          : [],
      };
    }
  }

  return null;
}

/**
 * Extract and normalize genres
 * Uses the genre-standardizer to normalize all genre names
 * @param {Object} detail - Full detail object from TMDB API
 * @returns {string[]} - Array of normalized genre names (deduplicated)
 */
export function extractGenres(detail) {
  if (!detail?.genres || !Array.isArray(detail.genres)) {
    return [];
  }

  const normalizedGenres = new Set();

  detail.genres.forEach((genre) => {
    if (genre.name) {
      const normalized = normalizeGenre(genre.name);
      normalized.forEach((g) => normalizedGenres.add(g));
    }
  });

  return Array.from(normalizedGenres);
}

/**
 * Extract all metadata from a TMDB detail response
 * Convenience function that extracts all fields at once
 * @param {Object} detail - Full detail object from TMDB API
 * @param {string} kind - "movie" or "tv"
 * @returns {Object} - Object with all extracted metadata fields
 */
export function extractAllMetadata(detail, kind) {
  if (!detail) {
    return {
      cast: [],
      director: null,
      writers: [],
      creators: [],
      keywords: [],
      genres: [],
      certification: null,
      production_countries: [],
      collection_id: null,
      collection_name: null,
      tagline: null,
      providers: null,
    };
  }

  // Use aggregate_credits for TV if available, otherwise regular credits
  const credits =
    kind === "tv"
      ? detail.aggregate_credits || detail.credits
      : detail.credits;

  const collection = kind === "movie" ? extractCollection(detail) : { collection_id: null, collection_name: null };

  return {
    cast: extractCast(credits),
    director: extractDirector(credits),
    writers: extractWriters(credits),
    creators: kind === "tv" ? extractCreators(detail) : [],
    keywords: extractKeywords(detail),
    genres: extractGenres(detail),
    certification: extractCertification(detail),
    production_countries: extractProductionCountries(detail),
    collection_id: collection.collection_id,
    collection_name: collection.collection_name,
    tagline: extractTagline(detail),
    providers: extractProviders(detail),
  };
}

