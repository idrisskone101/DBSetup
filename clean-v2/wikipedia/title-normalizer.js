/**
 * Comprehensive title normalization for Wikipedia matching
 * Handles Roman numerals, abbreviations, punctuation, and more
 */

/**
 * Roman numeral to Arabic number mapping
 */
const ROMAN_TO_ARABIC = {
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
  xvi: "16",
  xvii: "17",
  xviii: "18",
  xix: "19",
  xx: "20",
};

/**
 * Number words to digits
 */
const NUMBER_WORDS = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  first: "1st",
  second: "2nd",
  third: "3rd",
  fourth: "4th",
  fifth: "5th",
};

/**
 * Common abbreviation expansions
 */
const ABBREVIATIONS = {
  "vol.": "volume",
  "vol ": "volume ",
  "pt.": "part",
  "pt ": "part ",
  "ep.": "episode",
  "ep ": "episode ",
  "mr.": "mister",
  "dr.": "doctor",
  "st.": "saint",
  "sr.": "senior",
  "jr.": "junior",
  "vs.": "versus",
  "vs ": "versus ",
  "mt.": "mount",
  "ft.": "featuring",
  "bros.": "brothers",
  "dept.": "department",
  "govt.": "government",
  "intl.": "international",
  "natl.": "national",
  "univ.": "university",
  "assn.": "association",
  "inc.": "incorporated",
  "corp.": "corporation",
  "ltd.": "limited",
  "co.": "company",
};

/**
 * Character replacements for normalization
 */
const CHAR_REPLACEMENTS = {
  // Smart quotes to straight quotes
  "\u2018": "'", // '
  "\u2019": "'", // '
  "\u201C": '"', // "
  "\u201D": '"', // "
  "\u0060": "'", // `
  "\u00B4": "'", // ´

  // Dashes to standard hyphen
  "\u2013": "-", // en-dash
  "\u2014": "-", // em-dash
  "\u2015": "-", // horizontal bar
  "\u2212": "-", // minus sign

  // Ellipsis
  "\u2026": "...", // …

  // Ampersand handling (will be normalized separately)

  // Common accented characters to ASCII
  à: "a",
  á: "a",
  â: "a",
  ã: "a",
  ä: "a",
  å: "a",
  æ: "ae",
  ç: "c",
  è: "e",
  é: "e",
  ê: "e",
  ë: "e",
  ì: "i",
  í: "i",
  î: "i",
  ï: "i",
  ñ: "n",
  ò: "o",
  ó: "o",
  ô: "o",
  õ: "o",
  ö: "o",
  ø: "o",
  ù: "u",
  ú: "u",
  û: "u",
  ü: "u",
  ý: "y",
  ÿ: "y",
  ß: "ss",
  œ: "oe",
  À: "a",
  Á: "a",
  Â: "a",
  Ã: "a",
  Ä: "a",
  Å: "a",
  Æ: "ae",
  Ç: "c",
  È: "e",
  É: "e",
  Ê: "e",
  Ë: "e",
  Ì: "i",
  Í: "i",
  Î: "i",
  Ï: "i",
  Ñ: "n",
  Ò: "o",
  Ó: "o",
  Ô: "o",
  Õ: "o",
  Ö: "o",
  Ø: "o",
  Ù: "u",
  Ú: "u",
  Û: "u",
  Ü: "u",
  Ý: "y",
  Ÿ: "y",
};

/**
 * Replace characters using the replacement map
 * @param {string} text
 * @returns {string}
 */
function replaceChars(text) {
  let result = text;
  for (const [from, to] of Object.entries(CHAR_REPLACEMENTS)) {
    result = result.split(from).join(to);
  }
  return result;
}

/**
 * Convert Roman numerals to Arabic numbers
 * Only converts when Roman numeral appears to be intentional (standalone or at end)
 * @param {string} text
 * @returns {string}
 */
function convertRomanNumerals(text) {
  // Match Roman numerals at word boundaries, typically at end of title or standalone
  // e.g., "Rocky III" -> "Rocky 3", "Part II" -> "Part 2"
  return text.replace(
    /\b((?:x{0,2}(?:ix|iv|v?i{0,3})|x{1,2}(?:ix|iv|v?i{0,3})?))(?=\s|$|:|-|\))/gi,
    (match) => {
      const lower = match.toLowerCase();
      return ROMAN_TO_ARABIC[lower] || match;
    }
  );
}

/**
 * Convert number words to digits
 * @param {string} text
 * @returns {string}
 */
function convertNumberWords(text) {
  let result = text;
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    // Match whole words only
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    result = result.replace(regex, digit);
  }
  return result;
}

/**
 * Expand abbreviations
 * @param {string} text
 * @returns {string}
 */
function expandAbbreviations(text) {
  let result = text.toLowerCase();
  for (const [abbrev, expanded] of Object.entries(ABBREVIATIONS)) {
    result = result.split(abbrev).join(expanded);
  }
  return result;
}

/**
 * Normalize ampersand usage
 * @param {string} text
 * @returns {string}
 */
function normalizeAmpersand(text) {
  // Replace & with "and" for consistency
  return text.replace(/\s*&\s*/g, " and ");
}

/**
 * Remove common title suffixes/prefixes for comparison
 * @param {string} text
 * @returns {string}
 */
function removeDisambiguators(text) {
  return text
    .replace(/\s*\(film\)\s*/i, "")
    .replace(/\s*\(movie\)\s*/i, "")
    .replace(/\s*\(tv series\)\s*/i, "")
    .replace(/\s*\(tv show\)\s*/i, "")
    .replace(/\s*\(television series\)\s*/i, "")
    .replace(/\s*\(\d{4} film\)\s*/i, "")
    .replace(/\s*\(\d{4} tv series\)\s*/i, "")
    .replace(/\s*\(miniseries\)\s*/i, "")
    .replace(/\s*\(american tv series\)\s*/i, "")
    .replace(/\s*\(british tv series\)\s*/i, "")
    .replace(/\s*\(tv miniseries\)\s*/i, "")
    .replace(/\s*\(animated series\)\s*/i, "")
    .replace(/\s*\(animated film\)\s*/i, "")
    .replace(/\s*\(franchise\)\s*/i, "")
    .replace(/\s*\(series\)\s*/i, "")
    .trim();
}

/**
 * Handle "The" article variations
 * "The Matrix" and "Matrix, The" should match
 * @param {string} text
 * @returns {string}
 */
function normalizeArticle(text) {
  // Remove leading "The " or "A " or "An "
  let result = text.replace(/^(the|a|an)\s+/i, "");
  // Remove trailing ", The" or ", A" or ", An"
  result = result.replace(/,\s*(the|a|an)$/i, "");
  return result;
}

/**
 * Full title normalization for comparison
 * @param {string} title - Title to normalize
 * @param {Object} options - Normalization options
 * @param {boolean} options.removeArticle - Remove "The/A/An" (default: true)
 * @param {boolean} options.convertRoman - Convert Roman numerals (default: true)
 * @param {boolean} options.convertNumbers - Convert number words (default: true)
 * @returns {string}
 */
export function normalizeTitle(title, options = {}) {
  const {
    removeArticle = true,
    convertRoman = true,
    convertNumbers = true,
  } = options;

  if (!title) return "";

  let result = title.toLowerCase().trim();

  // Replace special characters
  result = replaceChars(result);

  // Normalize ampersand
  result = normalizeAmpersand(result);

  // Expand abbreviations
  result = expandAbbreviations(result);

  // Convert Roman numerals
  if (convertRoman) {
    result = convertRomanNumerals(result);
  }

  // Convert number words
  if (convertNumbers) {
    result = convertNumberWords(result);
  }

  // Remove disambiguators
  result = removeDisambiguators(result);

  // Normalize article
  if (removeArticle) {
    result = normalizeArticle(result);
  }

  // Normalize whitespace
  result = result.replace(/\s+/g, " ").trim();

  return result;
}

/**
 * Generate title variations for Wikipedia search
 * @param {string} title - Original title
 * @param {string} year - Release year
 * @param {"movie"|"tv"} kind - Type of content
 * @returns {string[]} - Array of title variations to try
 */
export function generateTitleVariations(title, year, kind) {
  const variations = new Set();

  // Clean title - preserve colons, commas, and important punctuation
  const cleanTitle = title.replace(/[^\w\s:',!?.-]/g, "").trim();
  variations.add(cleanTitle);

  // Expand abbreviations
  const expanded = cleanTitle
    .replace(/\bVol\.\s*/gi, "Volume ")
    .replace(/\bPt\.\s*/gi, "Part ")
    .replace(/\bEp\.\s*/gi, "Episode ")
    .replace(/\bMr\.\s*/gi, "Mister ")
    .replace(/\bDr\.\s*/gi, "Doctor ")
    .replace(/\bSt\.\s*/gi, "Saint ")
    .replace(/\bBros\.\s*/gi, "Brothers ")
    .trim();
  if (expanded !== cleanTitle) {
    variations.add(expanded);
  }

  // Try without colons
  const noColon = cleanTitle.replace(/:/g, "").replace(/\s+/g, " ").trim();
  if (noColon !== cleanTitle) {
    variations.add(noColon);
  }

  // Convert Roman numerals to Arabic
  const arabicNumerals = convertRomanNumerals(cleanTitle);
  if (arabicNumerals !== cleanTitle) {
    variations.add(arabicNumerals);
  }

  // Try with Arabic numerals AND expanded abbreviations
  const expandedArabic = convertRomanNumerals(expanded);
  if (expandedArabic !== expanded && expandedArabic !== cleanTitle) {
    variations.add(expandedArabic);
  }

  // Ampersand variations
  if (cleanTitle.includes("&")) {
    variations.add(cleanTitle.replace(/\s*&\s*/g, " and "));
  }
  if (cleanTitle.includes(" and ")) {
    variations.add(cleanTitle.replace(/\s+and\s+/gi, " & "));
  }

  // Build patterns array with disambiguators
  const patterns = [];

  // Add base variations first
  for (const variant of variations) {
    patterns.push(variant);
  }

  // Add disambiguated versions
  const primaryTitle = cleanTitle;
  if (kind === "movie") {
    patterns.push(`${primaryTitle} (${year} film)`);
    patterns.push(`${primaryTitle} (film)`);
  } else {
    patterns.push(`${primaryTitle} (${year} TV series)`);
    patterns.push(`${primaryTitle} (TV series)`);
    patterns.push(`${primaryTitle} (miniseries)`);
    patterns.push(`${primaryTitle} (American TV series)`);
    patterns.push(`${primaryTitle} (British TV series)`);
  }

  // Add year-only variant
  patterns.push(`${primaryTitle} (${year})`);

  // Deduplicate while preserving order
  return [...new Set(patterns)];
}

/**
 * Calculate similarity between two titles
 * Uses normalized comparison
 * @param {string} title1
 * @param {string} title2
 * @returns {number} - Similarity score 0-1
 */
export function titleSimilarity(title1, title2) {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);

  if (norm1 === norm2) return 1;

  // Check if one contains the other
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    return 0.9;
  }

  // Character-based similarity
  const longer = norm1.length > norm2.length ? norm1 : norm2;
  const shorter = norm1.length > norm2.length ? norm2 : norm1;

  if (longer.length === 0) return 1;

  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }

  return matches / longer.length;
}

/**
 * Check if two titles match (using normalized comparison)
 * @param {string} articleTitle - Wikipedia article title
 * @param {string} expectedTitle - Expected title from database
 * @returns {boolean}
 */
export function titlesMatch(articleTitle, expectedTitle) {
  if (!articleTitle || !expectedTitle) return false;

  const norm1 = normalizeTitle(articleTitle);
  const norm2 = normalizeTitle(expectedTitle);

  // Exact match after normalization
  if (norm1 === norm2) return true;

  // High similarity threshold
  return titleSimilarity(articleTitle, expectedTitle) >= 0.85;
}
