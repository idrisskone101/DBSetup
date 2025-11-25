// Wikipedia text fetching using Wikimedia APIs
// Refined for standardized metadata extraction
import { request } from "undici";

const WIKI = "https://en.wikipedia.org";
const MW = "https://en.wikipedia.org/w/api.php";

// Wikipedia API requires User-Agent header
const REQUEST_HEADERS = {
  "User-Agent": "MovieEnrichmentBot/1.0 (Educational/Research Project)",
  Accept: "application/json",
};

/**
 * Simple delay utility for rate limiting
 * @param {number} ms - Milliseconds to delay
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Search Wikipedia using the opensearch API
 * Fallback when direct title lookup fails
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {string} options.kind - 'movie' or 'tv' to filter results
 * @returns {Promise<string[]>} - Array of matching Wikipedia article titles
 */
async function searchWikipedia(query, options = {}) {
  try {
    const searchUrl = `${MW}?action=opensearch&search=${encodeURIComponent(query)}&limit=10&format=json`;
    const { body } = await request(searchUrl, { headers: REQUEST_HEADERS });
    const data = await body.json();

    // opensearch returns [query, [titles], [descriptions], [urls]]
    const titles = data[1] || [];
    
    if (titles.length === 0) {
      return [];
    }

    // Filter results based on kind to prioritize relevant articles
    const { kind } = options;
    const filtered = titles.filter((title) => {
      const lowerTitle = title.toLowerCase();
      
      // Skip disambiguation pages
      if (lowerTitle.includes("(disambiguation)")) return false;
      
      // Prioritize film/TV related articles
      if (kind === "movie") {
        // Accept if it contains "film" or doesn't have TV markers
        if (lowerTitle.includes("(film)")) return true;
        if (lowerTitle.includes("(tv series)") || lowerTitle.includes("(tv show)")) return false;
      } else if (kind === "tv") {
        // Accept if it contains "tv" or "series"
        if (lowerTitle.includes("(tv series)") || lowerTitle.includes("(tv show)") || lowerTitle.includes("(series)")) return true;
        if (lowerTitle.includes("(film)")) return false;
      }
      
      return true;
    });

    return filtered.length > 0 ? filtered : titles.slice(0, 5);
  } catch (error) {
    console.warn(`⚠️  Wikipedia search failed for "${query}": ${error.message}`);
    return [];
  }
}

/**
 * Fetch the lead/summary section from Wikipedia
 * Uses the REST API for cached, fast access
 * @param {string} title - Wikipedia article title
 * @returns {Promise<{summary: string|undefined, canonicalTitle: string|undefined, isDisambiguation: boolean}>}
 */
export async function getWikiSummary(title) {
  try {
    const url = `${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const { body } = await request(url, { headers: REQUEST_HEADERS });
    const data = await body.json();

    // Check if page exists
    if (
      data.type === "https://mediawiki.org/wiki/HyperSwitch/errors/not_found"
    ) {
      return {
        summary: undefined,
        canonicalTitle: undefined,
        isDisambiguation: false,
      };
    }

    // Check if this is a disambiguation page
    const isDisambiguation =
      data.type === "disambiguation" ||
      data.description?.toLowerCase().includes("disambiguation") ||
      data.extract?.toLowerCase().includes("may refer to:") ||
      title.toLowerCase().includes("(disambiguation)");

    // Return both the summary and the canonical title (handles redirects)
    return {
      summary: data.extract,
      canonicalTitle: data.titles?.canonical || title,
      isDisambiguation,
    };
  } catch (error) {
    // Don't warn for 404s - those are expected
    if (!error.message.includes("404")) {
      console.warn(
        `⚠️  Failed to fetch Wikipedia summary for "${title}": ${error.message}`,
      );
    }
    return {
      summary: undefined,
      canonicalTitle: undefined,
      isDisambiguation: false,
    };
  }
}

/**
 * Fetch the Plot section from a Wikipedia article
 * Uses the Action API to extract specific section content
 * @param {string} title - Wikipedia article title
 * @returns {Promise<string|undefined>} - Plot section text or undefined if not found
 */
export async function getWikiPlotSection(title) {
  try {
    // Step 1: Get section index for "Plot"
    const secUrl = `${MW}?action=parse&prop=sections&page=${encodeURIComponent(title)}&format=json`;
    const secResponse = await request(secUrl, { headers: REQUEST_HEADERS });
    const secData = await secResponse.body.json();

    if (secData.error) {
      return undefined;
    }

    // Find the Plot section (case-insensitive)
    // Also look for "Synopsis" or "Premise" if "Plot" isn't found
    const plotSection = secData.parse?.sections?.find((s) =>
      /plot|synopsis|premise/i.test(s.line),
    );

    if (!plotSection) {
      return undefined;
    }

    // Step 2: Fetch the Plot section text
    const txtUrl = `${MW}?action=parse&format=json&page=${encodeURIComponent(title)}&prop=text&section=${plotSection.index}`;
    const txtResponse = await request(txtUrl, { headers: REQUEST_HEADERS });
    const txtData = await txtResponse.body.json();

    const html = txtData.parse?.text?.["*"] ?? "";
    return stripHtml(html);
  } catch (error) {
    return undefined;
  }
}

/**
 * Strip HTML tags and clean up Wikipedia markup
 * @param {string} html - Raw HTML content
 * @returns {string} - Cleaned plain text
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ") // Remove all HTML tags
    .replace(/\s+\[\d+\]/g, " ") // Remove reference markers like [1]
    .replace(/\s+\[[a-z]\]/gi, " ") // Remove letter references like [a]
    .replace(/\s{2,}/g, " ") // Collapse multiple spaces
    .trim();
}

/**
 * Normalize title for Wikipedia search
 * @param {string} title - Original title
 * @returns {string} - Normalized title
 */
function normalizeTitle(title) {
  let normalized = title
    .replace(/\s*x\s*/gi, " × ") // "SPY x FAMILY" → "SPY × FAMILY"
    .trim();

  // Convert all-caps single words to title case
  const words = normalized.split(/\s+/);
  if (
    words.length === 1 &&
    normalized === normalized.toUpperCase() &&
    !normalized.includes(".")
  ) {
    normalized = normalized.charAt(0) + normalized.slice(1).toLowerCase();
  }

  return normalized;
}

/**
 * Generate Wikipedia URL for a title
 * @param {string} title - Wikipedia article title
 * @returns {string} - Full Wikipedia URL
 */
function getWikiUrl(title) {
  return `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

/**
 * Generate expanded title patterns for Wikipedia lookup
 * Handles colons, hyphens, anime, and regional TV variants
 * @param {string} baseTitle - Original title
 * @param {string} normalizedTitle - Normalized title
 * @param {Object} options - Options with year and kind
 * @returns {string[]} - Array of title patterns to try
 */
function generateTitlePatterns(baseTitle, normalizedTitle, options = {}) {
  const { year, kind } = options;
  const patterns = [];
  const seen = new Set();

  const addPattern = (pattern) => {
    if (pattern && !seen.has(pattern.toLowerCase())) {
      seen.add(pattern.toLowerCase());
      patterns.push(pattern);
    }
  };

  // Primary patterns based on kind
  if (kind === "movie") {
    if (year) addPattern(`${normalizedTitle} (${year} film)`);
    addPattern(`${normalizedTitle} (film)`);
    if (year) addPattern(`${normalizedTitle} (${year})`);
    // Anime film patterns
    addPattern(`${normalizedTitle} (anime film)`);
    addPattern(`${normalizedTitle} (animated film)`);
  } else if (kind === "tv") {
    if (year) addPattern(`${normalizedTitle} (${year} TV series)`);
    addPattern(`${normalizedTitle} (TV series)`);
    // Regional TV series variants
    addPattern(`${normalizedTitle} (American TV series)`);
    addPattern(`${normalizedTitle} (British TV series)`);
    addPattern(`${normalizedTitle} (miniseries)`);
    if (year) addPattern(`${normalizedTitle} (${year})`);
    // Anime TV patterns
    addPattern(`${normalizedTitle} (anime)`);
    addPattern(`${normalizedTitle} (TV anime)`);
  }

  // Base title without qualifiers
  if (!normalizedTitle.toLowerCase().includes("(disambiguation)")) {
    addPattern(normalizedTitle);
  }

  // Original title if different
  if (normalizedTitle !== baseTitle && !baseTitle.toLowerCase().includes("(disambiguation)")) {
    addPattern(baseTitle);
  }

  // Handle colons in titles: "IT: Welcome to Derry" → "Welcome to Derry"
  if (normalizedTitle.includes(":")) {
    const parts = normalizedTitle.split(":").map((p) => p.trim());
    
    // Try the part after the colon (often the main title for sequels/spinoffs)
    if (parts.length >= 2 && parts[1].length > 3) {
      const afterColon = parts[1];
      if (kind === "movie") {
        if (year) addPattern(`${afterColon} (${year} film)`);
        addPattern(`${afterColon} (film)`);
      } else if (kind === "tv") {
        if (year) addPattern(`${afterColon} (${year} TV series)`);
        addPattern(`${afterColon} (TV series)`);
        addPattern(`${afterColon} (American TV series)`);
      }
      addPattern(afterColon);
    }
    
    // Try the full title with different separators
    const colonToHyphen = normalizedTitle.replace(/:\s*/g, " – ");
    addPattern(colonToHyphen);
  }

  // Handle hyphens/dashes in titles: "Captain Hook - The Cursed Tides" → "Captain Hook"
  const hyphenMatch = normalizedTitle.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (hyphenMatch) {
    const beforeHyphen = hyphenMatch[1].trim();
    const afterHyphen = hyphenMatch[2].trim();
    
    // Try the part before the hyphen (often the main character/franchise name)
    if (beforeHyphen.length > 2) {
      if (kind === "movie") {
        if (year) addPattern(`${beforeHyphen} (${year} film)`);
        addPattern(`${beforeHyphen} (film)`);
      } else if (kind === "tv") {
        if (year) addPattern(`${beforeHyphen} (${year} TV series)`);
        addPattern(`${beforeHyphen} (TV series)`);
      }
      addPattern(beforeHyphen);
    }
    
    // Try full title with en-dash (Wikipedia standard)
    const withEnDash = `${beforeHyphen} – ${afterHyphen}`;
    addPattern(withEnDash);
  }

  // Handle anime titles with Japanese characters or "no"
  if (normalizedTitle.includes(" no ") || /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/.test(normalizedTitle)) {
    // This is likely anime
    if (kind === "movie") {
      addPattern(`${normalizedTitle} (film)`);
      addPattern(`${normalizedTitle} (anime film)`);
    }
    addPattern(`${normalizedTitle} (anime)`);
    
    // Try without "no" for localized titles
    const withoutNo = normalizedTitle.replace(/ no /gi, ": ");
    if (withoutNo !== normalizedTitle) {
      addPattern(withoutNo);
    }
  }

  return patterns;
}

/**
 * Validate that a Wikipedia article is about a film/TV show, not something else
 * @param {string} summary - Article summary text
 * @param {string} kind - 'movie' or 'tv'
 * @returns {boolean} - True if article appears to be about the right type of content
 */
function isRelevantArticle(summary, kind) {
  if (!summary) return true; // If no summary, can't validate, so allow

  const lowerSummary = summary.toLowerCase();
  
  // Keywords that indicate this is a film/TV article
  const mediaKeywords = [
    "film", "movie", "motion picture",
    "television", "tv series", "tv show", "miniseries", "web series",
    "anime", "animated series", "cartoon",
    "directed by", "starring", "produced by",
    "released", "premiered", "aired"
  ];
  
  // Check if summary mentions media-related terms
  const hasMediaTerms = mediaKeywords.some((kw) => lowerSummary.includes(kw));
  
  // Keywords that indicate this is NOT what we're looking for
  const nonMediaKeywords = [
    "genus of", "species of", "family of", // Biology
    "municipality", "village", "town in", "city in", // Geography
    "footballer", "cricketer", "athlete", "politician", // People (unless actors)
    "album by", "song by", "single by" // Music (unless soundtracks)
  ];
  
  const hasNonMediaTerms = nonMediaKeywords.some((kw) => lowerSummary.includes(kw));
  
  // Prefer articles with media terms and without non-media terms
  return hasMediaTerms || !hasNonMediaTerms;
}

/**
 * Fetch both summary and plot for a title with fallback title resolution and search
 * @param {string} baseTitle - Base title to search for
 * @param {Object} options - Options for title resolution
 * @param {string} options.year - Release year (optional)
 * @param {string} options.kind - 'movie' or 'tv' (optional)
 * @param {Object} options.rateLimiter - Optional rate limiter instance
 * @returns {Promise<{summary: string|undefined, plot: string|undefined, foundTitle: string|undefined, url: string|undefined}>}
 */
export async function getWikiContent(baseTitle, options = {}) {
  const { year, kind, rateLimiter } = options;
  const normalizedTitle = normalizeTitle(baseTitle);
  
  // Generate expanded title patterns
  const patterns = generateTitlePatterns(baseTitle, normalizedTitle, options);

  // Helper to apply rate limiting
  const applyRateLimit = async () => {
    if (rateLimiter) {
      await rateLimiter.acquire();
    }
  };

  // Phase 1: Try direct title lookups with expanded patterns
  for (const title of patterns) {
    await applyRateLimit();
    const { summary, canonicalTitle, isDisambiguation } = await getWikiSummary(title);

    if (!summary && !canonicalTitle) continue;

    if (isDisambiguation) continue;

    if (summary && summary.toLowerCase().includes("may refer to")) continue;

    // Validate the article is about a film/TV show
    if (!isRelevantArticle(summary, kind)) continue;

    await applyRateLimit();
    const plot = await getWikiPlotSection(canonicalTitle || title);

    if (summary || plot) {
      const foundTitle = canonicalTitle || title;
      if (rateLimiter) rateLimiter.reportSuccess();
      return { 
        summary, 
        plot, 
        foundTitle,
        url: getWikiUrl(foundTitle)
      };
    }
  }

  // Phase 2: Fall back to Wikipedia search API
  const searchQueries = [
    `${normalizedTitle} ${year || ""} ${kind === "movie" ? "film" : kind === "tv" ? "TV series" : ""}`.trim(),
    normalizedTitle,
  ];

  // Add search for part after colon if present
  if (normalizedTitle.includes(":")) {
    const afterColon = normalizedTitle.split(":")[1]?.trim();
    if (afterColon && afterColon.length > 3) {
      searchQueries.push(`${afterColon} ${kind === "movie" ? "film" : kind === "tv" ? "TV series" : ""}`.trim());
    }
  }

  for (const query of searchQueries) {
    await applyRateLimit();
    const searchResults = await searchWikipedia(query, { kind });
    
    for (const searchTitle of searchResults) {
      await applyRateLimit();
      const { summary, canonicalTitle, isDisambiguation } = await getWikiSummary(searchTitle);

      if (!summary && !canonicalTitle) continue;
      if (isDisambiguation) continue;
      if (summary && summary.toLowerCase().includes("may refer to")) continue;
      if (!isRelevantArticle(summary, kind)) continue;

      await applyRateLimit();
      const plot = await getWikiPlotSection(canonicalTitle || searchTitle);

      if (summary || plot) {
        const foundTitle = canonicalTitle || searchTitle;
        if (rateLimiter) rateLimiter.reportSuccess();
        return { 
          summary, 
          plot, 
          foundTitle,
          url: getWikiUrl(foundTitle)
        };
      }
    }
  }

  // No content found
  return { 
    summary: undefined, 
    plot: undefined, 
    foundTitle: undefined,
    url: undefined
  };
}
