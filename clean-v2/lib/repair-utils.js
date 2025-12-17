/**
 * Repair utilities - diagnosis, retry logic, priority scoring
 */

// Retry intervals in hours
const RETRY_HOURS = {
  api_error: 24,
  partial: 24,
  llm_error: 24,
  wiki_not_found: 168, // weekly
  validation_failed: 168,
  not_found: null, // never
  no_data: null, // never
  success: null, // never
};

// TMDB fields that can be repaired
const TMDB_FIELDS = [
  "overview",
  "tagline",
  "director",
  "creators",
  "cast",
  "writers",
  "keywords",
  "genres",
  "certification",
  "runtime_minutes",
];

// Enrichment fields that can be repaired
const ENRICHMENT_FIELDS = [
  "wiki_source_url",
  "vibes",
  "tone",
  "pacing",
  "themes",
  "profile_string",
  "slots",
  "vibe_embedding",
  "content_embedding",
  "metadata_embedding",
];

/**
 * Diagnose missing TMDB fields for a title
 * @param {Object} title
 * @returns {Object} - { missing: string[], hasMissing: boolean }
 */
export function diagnoseMissingTMDBFields(title) {
  const missing = [];

  if (!title.overview) missing.push("overview");
  if (!title.tagline) missing.push("tagline");
  if (title.kind === "movie" && !title.director) missing.push("director");
  if (title.kind === "tv" && (!title.creators || title.creators.length === 0)) missing.push("creators");
  if (!title.cast || title.cast.length === 0) missing.push("cast");
  if (!title.writers || title.writers.length === 0) missing.push("writers");
  if (!title.keywords || title.keywords.length === 0) missing.push("keywords");
  if (!title.genres || title.genres.length === 0) missing.push("genres");
  if (!title.certification) missing.push("certification");
  if (!title.runtime_minutes) missing.push("runtime_minutes");

  return {
    missing,
    hasMissing: missing.length > 0,
  };
}

/**
 * Diagnose enrichment needs for a title
 * @param {Object} title
 * @returns {Object} - { missing: string[], hasMissing: boolean, categories: Object }
 */
export function diagnoseEnrichmentNeeds(title) {
  const missing = [];
  const categories = {
    wiki: false,
    llm: false,
    embeddings: false,
  };

  if (!title.wiki_source_url) {
    missing.push("wiki_source_url");
    categories.wiki = true;
  }

  if (!title.vibes || Object.keys(title.vibes).length === 0) {
    missing.push("vibes");
    categories.llm = true;
  }
  if (!title.tone) {
    missing.push("tone");
    categories.llm = true;
  }
  if (!title.pacing) {
    missing.push("pacing");
    categories.llm = true;
  }
  if (!title.themes || title.themes.length === 0) {
    missing.push("themes");
    categories.llm = true;
  }
  if (!title.profile_string) {
    missing.push("profile_string");
    categories.llm = true;
  }
  if (!title.slots) {
    missing.push("slots");
    categories.llm = true;
  }

  if (!title.vibe_embedding) {
    missing.push("vibe_embedding");
    categories.embeddings = true;
  }
  if (!title.content_embedding) {
    missing.push("content_embedding");
    categories.embeddings = true;
  }
  if (!title.metadata_embedding) {
    missing.push("metadata_embedding");
    categories.embeddings = true;
  }

  return {
    missing,
    hasMissing: missing.length > 0,
    categories,
  };
}

/**
 * Check if a repair status should be retried based on time elapsed
 * @param {string} status - Current repair status
 * @param {Date|string|null} attemptedAt - Last attempt timestamp
 * @returns {boolean}
 */
export function shouldRetry(status, attemptedAt) {
  if (!status) return true; // Never attempted
  if (status === "pending") return true;

  const retryHours = RETRY_HOURS[status];
  if (retryHours === null) return false; // Never retry

  if (!attemptedAt) return true;

  const lastAttempt = new Date(attemptedAt);
  const hoursSince = (Date.now() - lastAttempt.getTime()) / (1000 * 60 * 60);

  return hoursSince >= retryHours;
}

/**
 * Calculate repair priority score (higher = more important)
 * @param {Object} title
 * @param {Object} diagnosis - From diagnoseMissingTMDBFields or diagnoseEnrichmentNeeds
 * @returns {number}
 */
export function calculateRepairPriority(title, diagnosis) {
  let score = 0;

  // Base priority: number of missing fields
  score += diagnosis.missing.length * 10;

  // Critical fields boost
  if (diagnosis.missing.includes("overview")) score += 50;
  if (diagnosis.missing.includes("vibes")) score += 30;
  if (diagnosis.missing.includes("themes")) score += 20;

  // Embeddings-only repairs are quick wins
  if (diagnosis.categories?.embeddings && !diagnosis.categories?.llm && !diagnosis.categories?.wiki) {
    score += 100; // Prioritize quick wins
  }

  return score;
}

/**
 * Build TMDB repair status object for database update
 * @param {string} status - 'success' | 'not_found' | 'api_error' | 'no_data'
 * @param {string|null} error - Error message if applicable
 * @returns {Object}
 */
export function buildTMDBRepairStatus(status, error = null) {
  return {
    tmdb_repair_status: status,
    tmdb_repair_attempted_at: new Date().toISOString(),
    tmdb_repair_error: error,
  };
}

/**
 * Build enrichment repair status object for database update
 * @param {string} status - 'success' | 'partial' | 'wiki_not_found' | 'llm_error' | 'validation_failed'
 * @param {string|null} error - Error message if applicable
 * @returns {Object}
 */
export function buildEnrichmentRepairStatus(status, error = null) {
  return {
    enrichment_repair_status: status,
    enrichment_repair_attempted_at: new Date().toISOString(),
    enrichment_repair_error: error,
  };
}

/**
 * Filter titles that need TMDB repair based on field and retry logic
 * @param {Array} titles
 * @param {Object} options
 * @param {string} [options.field] - Target specific field
 * @param {boolean} [options.retryErrors] - Re-attempt api_error status
 * @returns {Array}
 */
export function filterTMDBRepairCandidates(titles, { field, retryErrors } = {}) {
  return titles.filter((title) => {
    // Skip titles marked as not_found or no_data (permanent failures)
    if (title.tmdb_repair_status === "not_found" || title.tmdb_repair_status === "no_data") {
      return false;
    }

    // Handle retry-errors flag
    if (title.tmdb_repair_status === "api_error") {
      if (!retryErrors) return false;
      if (!shouldRetry("api_error", title.tmdb_repair_attempted_at)) return false;
    }

    // Check if specific field is missing
    if (field) {
      const diagnosis = diagnoseMissingTMDBFields(title);
      return diagnosis.missing.includes(field);
    }

    return true;
  });
}

/**
 * Filter titles that need enrichment repair based on mode and retry logic
 * @param {Array} titles
 * @param {Object} options
 * @param {string} [options.mode] - 'all' | 'wiki-only' | 'embeddings-only'
 * @param {string} [options.field] - Target specific field
 * @param {boolean} [options.retryPartial] - Re-attempt partial status
 * @returns {Array}
 */
export function filterEnrichmentRepairCandidates(titles, { mode = "all", field, retryPartial } = {}) {
  return titles.filter((title) => {
    // Handle retry logic for various statuses
    const status = title.enrichment_repair_status;
    if (status === "success") return false;

    if (status === "partial" && !retryPartial) {
      if (!shouldRetry("partial", title.enrichment_repair_attempted_at)) return false;
    }

    if (status === "wiki_not_found" || status === "llm_error" || status === "validation_failed") {
      if (!shouldRetry(status, title.enrichment_repair_attempted_at)) return false;
    }

    const diagnosis = diagnoseEnrichmentNeeds(title);

    // Mode-based filtering
    if (mode === "wiki-only") {
      return diagnosis.categories.wiki;
    }
    if (mode === "embeddings-only") {
      return diagnosis.categories.embeddings && !diagnosis.categories.llm && !diagnosis.categories.wiki;
    }

    // Field-based filtering
    if (field) {
      return diagnosis.missing.includes(field);
    }

    return diagnosis.hasMissing;
  });
}

export { TMDB_FIELDS, ENRICHMENT_FIELDS, RETRY_HOURS };
