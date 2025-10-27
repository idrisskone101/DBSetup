import axios from "axios";

const TMDB = axios.create({
  baseURL: "https://api.themoviedb.org/3",
  headers: {
    Authorization: `Bearer ${process.env.TMDB_TOKEN}`,
    "Content-Type": "application/json;charset=utf-8",
  },
});

export async function getConfig() {
  const { data } = await TMDB.get("/configuration");
  return data; // contains images base_url, etc. cache as needed
}

/* Discovery pages */
export async function getMoviesPage(page = 1) {
  const { data } = await TMDB.get("/discover/movie", {
    params: { page, sort_by: "popularity.desc" },
  });
  return data.results;
}

export async function getTvPage(page = 1) {
  const { data } = await TMDB.get("/discover/tv", {
    params: { page, sort_by: "popularity.desc" },
  });
  return data.results;
}

/* Details with useful expansions:
   - credits helps you build richer embeddings later
   - watch/providers for where-to-watch
   - external_ids gives imdb_id (esp. for TV)
   - keywords is handy for vibe-text
*/
export async function getMovieDetails(id) {
  const { data } = await TMDB.get(`/movie/${id}`, {
    params: {
      append_to_response:
        "credits,watch/providers,external_ids,keywords,release_dates",
    },
  });
  return data;
}

export async function getTvDetails(id) {
  const { data } = await TMDB.get(`/tv/${id}`, {
    params: {
      append_to_response:
        "credits,watch/providers,external_ids,keywords,content_ratings,aggregate_credits",
    },
  });
  return data;
}

/* ----- Extraction functions for enrichment data ----- */

/**
 * Extract top cast members (top 10 by order)
 * @param {Object} credits - credits object from TMDB API
 * @returns {Array} Array of {name, character, order, profile_path}
 */
export function extractTopCast(credits) {
  if (!credits || !Array.isArray(credits.cast)) return [];

  return credits.cast
    .slice(0, 10) // Top 10
    .map((member) => ({
      name: member.name,
      character: member.character || null,
      order: member.order,
      profile_path: member.profile_path || null,
    }));
}

/**
 * Extract primary director from crew
 * @param {Object} credits - credits object from TMDB API
 * @returns {string|null} Director name
 */
export function extractDirector(credits) {
  if (!credits || !Array.isArray(credits.crew)) return null;

  const director = credits.crew.find((member) => member.job === "Director");
  return director ? director.name : null;
}

/**
 * Extract writers (screenplay and story, max 5)
 * Prioritizes screenplay over story credits
 * @param {Object} credits - credits object from TMDB API
 * @returns {Array} Array of writer names
 */
export function extractWriters(credits) {
  if (!credits || !Array.isArray(credits.crew)) return [];

  const writerJobs = ["Screenplay", "Writer", "Story"];
  const writers = credits.crew
    .filter((member) => writerJobs.includes(member.job))
    .map((member) => member.name);

  // De-duplicate and limit to 5
  return [...new Set(writers)].slice(0, 5);
}

/**
 * Extract TV show creators
 * @param {Object} detail - TV detail object from TMDB API
 * @returns {Array} Array of creator names
 */
export function extractCreators(detail) {
  if (!detail || !Array.isArray(detail.created_by)) return [];

  return detail.created_by.map((creator) => creator.name);
}

/**
 * Extract certification/age rating for a specific region
 * @param {Object} detail - Movie/TV detail object from TMDB API
 * @param {string} region - Region code (default: 'US')
 * @returns {string|null} Certification (e.g., 'PG-13', 'TV-MA')
 */
export function extractCertification(detail, region = "US") {
  // For movies: release_dates
  if (detail.release_dates?.results) {
    const regionData = detail.release_dates.results.find(
      (r) => r.iso_3166_1 === region,
    );
    if (regionData?.release_dates?.[0]?.certification) {
      return regionData.release_dates[0].certification;
    }
  }

  // For TV: content_ratings
  if (detail.content_ratings?.results) {
    const rating = detail.content_ratings.results.find(
      (r) => r.iso_3166_1 === region,
    );
    return rating?.rating || null;
  }

  return null;
}

/**
 * Extract keywords from TMDB
 * @param {Object} detail - Movie/TV detail object from TMDB API
 * @returns {Array} Array of keyword strings
 */
export function extractKeywords(detail) {
  // Movies use detail.keywords.keywords
  // TV shows use detail.keywords.results
  const keywordArray =
    detail.keywords?.keywords || detail.keywords?.results || [];

  if (!Array.isArray(keywordArray)) return [];

  return keywordArray.map((kw) => kw.name);
}

/**
 * Extract collection/franchise info
 * @param {Object} detail - Movie detail object from TMDB API
 * @returns {Object} {collection_id, collection_name}
 */
export function extractCollection(detail) {
  if (!detail.belongs_to_collection) {
    return { collection_id: null, collection_name: null };
  }

  return {
    collection_id: detail.belongs_to_collection.id,
    collection_name: detail.belongs_to_collection.name,
  };
}

/**
 * Extract production countries
 * @param {Object} detail - Movie/TV detail object from TMDB API
 * @returns {Array} Array of country codes
 */
export function extractProductionCountries(detail) {
  if (!Array.isArray(detail.production_countries)) return [];

  return detail.production_countries
    .map((country) => country.iso_3166_1)
    .filter(Boolean);
}

/* ----- Normalizers to match your schema ----- */

const pick = (obj, path, fallback = null) =>
  path
    .split(".")
    .reduce((acc, k) => (acc && acc[k] != null ? acc[k] : null), obj) ??
  fallback;

export function normalizeProviders(
  detail,
  region = process.env.REGION || "CA",
) {
  const byRegion = pick(detail, `watch/providers.results.${region}`, {});
  const take = (arr) =>
    Array.isArray(arr)
      ? arr.map((x) => ({
          provider_id: x.provider_id,
          provider_name: x.provider_name,
          display_priority: x.display_priority,
        }))
      : [];

  return {
    region,
    flatrate: take(byRegion.flatrate),
    rent: take(byRegion.rent),
    buy: take(byRegion.buy),
  };
}

export function normalizeMovie(detail) {
  const collection = extractCollection(detail);

  return {
    id: detail.id,
    kind: "movie",
    imdb_id: detail.imdb_id || pick(detail, "external_ids.imdb_id", null),
    title: detail.title,
    original_title:
      detail.original_title || detail.original_name || detail.title,
    overview: detail.overview || null,
    release_date: detail.release_date || null,
    runtime_minutes: detail.runtime || null,
    poster_path: detail.poster_path || null,
    backdrop_path: detail.backdrop_path || null,
    vote_average: detail.vote_average ?? null,
    vote_count: detail.vote_count ?? null,
    popularity: detail.popularity ?? null,
    genres: (detail.genres || []).map((g) => g.name),
    languages: (detail.spoken_languages || [])
      .map((l) => l.iso_639_1 || l.english_name)
      .filter(Boolean),
    providers: normalizeProviders(detail),

    // Enrichment data
    cast: extractTopCast(detail.credits),
    director: extractDirector(detail.credits),
    writers: extractWriters(detail.credits),
    creators: [], // Movies don't have creators
    collection_id: collection.collection_id,
    collection_name: collection.collection_name,
    certification: extractCertification(detail),
    production_countries: extractProductionCountries(detail),
    keywords: extractKeywords(detail),
    tagline: detail.tagline || null,

    payload: detail, // keep the full raw payload for future needs
  };
}

export function normalizeTv(detail) {
  // TV uses different fields for date/runtime
  const episodeRunTimes = Array.isArray(detail.episode_run_time)
    ? detail.episode_run_time
    : [];
  const typicalRuntime = episodeRunTimes.length ? episodeRunTimes[0] : null;

  // Use aggregate_credits if available (all seasons), fallback to credits
  const credits = detail.aggregate_credits || detail.credits;

  return {
    id: detail.id,
    kind: "tv",
    imdb_id: pick(detail, "external_ids.imdb_id", null),
    title: detail.name,
    original_title: detail.original_name || detail.name,
    overview: detail.overview || null,
    release_date: detail.first_air_date || null,
    runtime_minutes: typicalRuntime,
    poster_path: detail.poster_path || null,
    backdrop_path: detail.backdrop_path || null,
    vote_average: detail.vote_average ?? null,
    vote_count: detail.vote_count ?? null,
    popularity: detail.popularity ?? null,
    genres: (detail.genres || []).map((g) => g.name),
    languages: (detail.spoken_languages || [])
      .map((l) => l.iso_639_1 || l.english_name)
      .filter(Boolean),
    providers: normalizeProviders(detail),

    // Enrichment data
    cast: extractTopCast(credits),
    director: extractDirector(credits), // TV may not have a single director
    writers: extractWriters(credits),
    creators: extractCreators(detail),
    collection_id: null, // TV shows don't have collections
    collection_name: null,
    certification: extractCertification(detail),
    production_countries: extractProductionCountries(detail),
    keywords: extractKeywords(detail),
    tagline: detail.tagline || null,

    payload: detail,
  };
}
