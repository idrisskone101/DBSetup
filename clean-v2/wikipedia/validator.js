/**
 * Wikipedia article validator
 * CRITICAL: This fixes the bug where wrong articles were being matched
 */

import { normalizeTitle, titleSimilarity, titlesMatch } from "./title-normalizer.js";

/**
 * Check if article title matches expected title
 * @param {string} articleTitle - Wikipedia article title
 * @param {string} expectedTitle - Expected movie/TV title
 * @returns {boolean}
 */
function titleMatches(articleTitle, expectedTitle) {
  return titlesMatch(articleTitle, expectedTitle);
}

/**
 * Check if article mentions media type (film/TV)
 * @param {string} extract - Article extract (first paragraph)
 * @param {"movie"|"tv"} kind
 * @returns {boolean}
 */
function mentionsMediaType(extract, kind) {
  if (!extract) return false;

  const text = extract.toLowerCase();

  // Check first 500 characters (should be in first paragraph)
  const firstPart = text.slice(0, 500);

  if (kind === "movie") {
    // Look for film-related terms
    const filmTerms = [
      "film",
      "movie",
      "motion picture",
      "theatrical release",
      "directed by",
      "starring",
      "feature film",
      "animated feature",
      "documentary",
      "horror film",
      "comedy film",
      "action film",
      "drama film",
      "sci-fi film",
      "science fiction film",
    ];
    return filmTerms.some((term) => firstPart.includes(term));
  } else {
    // Look for TV-related terms
    const tvTerms = [
      "television",
      "tv series",
      "tv show",
      "television series",
      "miniseries",
      "streaming series",
      "netflix series",
      "hbo series",
      "amazon series",
      "apple tv+ series",
      "disney+ series",
      "hulu series",
      "created by",
      "sitcom",
      "comedy series",
      "drama series",
      "soap opera",
      "british sitcom",
      "american sitcom",
      "animated series",
      "anime series",
      "talk show",
      "game show",
      "reality series",
      "reality show",
      "anthology series",
      "prime time",
      "primetime",
      "aired on",
      "broadcast on",
      "premiered on",
      "first aired",
      "web series",
      "limited series",
      "television program",
      "tv program",
      "television show",
      "cartoon series",
      "children's series",
      "kids' series",
    ];
    return tvTerms.some((term) => firstPart.includes(term));
  }
}

/**
 * Check if article mentions the release year
 * @param {string} content - Article content
 * @param {string} year - Expected release year
 * @returns {boolean}
 */
function mentionsYear(content, year) {
  if (!content || !year) return false;

  // Accept year or adjacent years (release dates can vary by region)
  const yearNum = parseInt(year, 10);
  if (isNaN(yearNum)) return false;

  const yearsToCheck = [yearNum - 1, yearNum, yearNum + 1].map(String);

  return yearsToCheck.some((y) => content.includes(y));
}

/**
 * Check if article mentions director name
 * @param {string} content - Article content
 * @param {string} director - Director name from TMDB
 * @returns {boolean}
 */
function mentionsDirector(content, director) {
  if (!content || !director) return false;

  const text = content.toLowerCase();
  const directorLower = director.toLowerCase();

  // Check for full name
  if (text.includes(directorLower)) return true;

  // Check for last name only
  const lastName = directorLower.split(" ").pop();
  if (lastName && lastName.length > 3 && text.includes(lastName)) {
    return true;
  }

  return false;
}

/**
 * Check if article mentions any cast members
 * @param {string} content - Article content
 * @param {Array<{name: string}>} cast - Cast from TMDB
 * @returns {number} - Number of cast members mentioned
 */
function countCastMentions(content, cast) {
  if (!content || !Array.isArray(cast) || cast.length === 0) return 0;

  const text = content.toLowerCase();

  let mentions = 0;
  for (const member of cast.slice(0, 5)) {
    // Check top 5 cast
    if (member.name && text.includes(member.name.toLowerCase())) {
      mentions++;
    }
  }

  return mentions;
}

/**
 * Validate that a Wikipedia article is about the expected title
 * @param {Object} article - Wikipedia article data
 * @param {string} article.title - Article title
 * @param {string} article.extract - Article extract (first paragraph)
 * @param {string} article.content - Full article content
 * @param {string} expectedTitle - Expected title
 * @param {string} year - Release year
 * @param {"movie"|"tv"} kind - Type of title
 * @param {Object} tmdbData - TMDB data for cross-reference
 * @param {string} [tmdbData.director] - Director name
 * @param {Array<{name: string}>} [tmdbData.cast] - Cast list
 * @returns {{isValid: boolean, confidence: number, reasons: string[]}}
 */
export function validateArticle(article, expectedTitle, year, kind, tmdbData = {}) {
  const reasons = [];
  let confidence = 0;

  // 1. Title similarity check (30% weight)
  if (titleMatches(article.title, expectedTitle)) {
    confidence += 0.3;
    reasons.push("Title matches");
  } else {
    reasons.push(`Title mismatch: "${article.title}" vs "${expectedTitle}"`);
  }

  // 2. Media type check (25% weight) - CRITICAL
  if (mentionsMediaType(article.extract, kind)) {
    confidence += 0.25;
    reasons.push(`Article mentions ${kind === "movie" ? "film" : "TV"} in first paragraph`);
  } else {
    reasons.push(`No ${kind === "movie" ? "film" : "TV"} mention in first paragraph`);
  }

  // 3. Year check (15% weight)
  if (mentionsYear(article.content || article.extract, year)) {
    confidence += 0.15;
    reasons.push(`Year ${year} mentioned`);
  } else {
    reasons.push(`Year ${year} not found`);
  }

  // 4. Director check (15% weight for movies)
  if (kind === "movie" && tmdbData.director) {
    if (mentionsDirector(article.content || article.extract, tmdbData.director)) {
      confidence += 0.15;
      reasons.push(`Director ${tmdbData.director} mentioned`);
    } else {
      reasons.push(`Director ${tmdbData.director} not found`);
    }
  } else if (kind === "tv") {
    // For TV, give partial credit if we couldn't check director
    confidence += 0.075;
  }

  // 5. Cast check (15% weight)
  if (tmdbData.cast && tmdbData.cast.length > 0) {
    const castMentions = countCastMentions(article.content || article.extract, tmdbData.cast);
    if (castMentions >= 2) {
      confidence += 0.15;
      reasons.push(`${castMentions} cast members mentioned`);
    } else if (castMentions === 1) {
      confidence += 0.075;
      reasons.push("1 cast member mentioned");
    } else {
      reasons.push("No cast members found");
    }
  }

  return {
    isValid: confidence >= 0.7,
    confidence: Math.round(confidence * 100) / 100,
    reasons,
  };
}

/**
 * Quick check if an article is obviously wrong
 * @param {string} extract - Article extract
 * @returns {boolean} - True if article is definitely wrong
 */
export function isObviouslyWrong(extract) {
  if (!extract) return true;

  const text = extract.toLowerCase().slice(0, 300);

  // Check for obvious wrong article types
  const wrongIndicators = [
    "is a city",
    "is a town",
    "is a village",
    "is a country",
    "is a state",
    "is a province",
    "is a river",
    "is a mountain",
    "is a lake",
    "is a sea",
    "is a ocean",
    "is a politician",
    "is a scientist",
    "is a species",
    "is a genus",
    "is a protein",
    "is a chemical",
    "is a company",
    "is an organization",
    "is a university",
    "is a college",
    "is a school",
    "is a hospital",
    "is a stadium",
    "is a building",
    "is a song",
    "is an album",
    "is a band",
    "is a musician",
    "is a singer",
    "is a rapper",
    "is a composer",
    "is a book",
    "is a novel",
    "is a video game",
    "is a board game",
    "is a card game",
    "is a sport",
    "is an athlete",
    "is a footballer",
    "is a basketball player",
    "is a baseball player",
    "is a restaurant",
    "is a food",
    "is a dish",
    "is a beverage",
    "is a drink",
    "is a car",
    "is an automobile",
    "is a vehicle",
    "is a ship",
    "is an aircraft",
    "is a plane",
    "is a train",
    "is a military",
    "is a weapon",
    "is a battle",
    "is a war",
  ];

  return wrongIndicators.some((indicator) => text.includes(indicator));
}
