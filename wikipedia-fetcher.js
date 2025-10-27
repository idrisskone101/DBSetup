// Wikipedia text fetching using Wikimedia APIs
// Implements Step 1 from the enrichment plan with fallback title resolution
import { request } from "undici";

const WIKI = "https://en.wikipedia.org";
const MW = "https://en.wikipedia.org/w/api.php";

// Wikipedia API requires User-Agent header
// See: https://meta.wikimedia.org/wiki/User-Agent_policy
const REQUEST_HEADERS = {
  "User-Agent": "MovieEnrichmentBot/1.0 (Educational/Research Project)",
  Accept: "application/json",
};

/**
 * Fetch the lead/summary section from Wikipedia
 * Uses the REST API for cached, fast access
 * @param {string} title - Wikipedia article title
 * @returns {Promise<{summary: string|undefined, canonicalTitle: string|undefined, isDisambiguation: boolean}>} - Synopsis and canonical title
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
    // Disambiguation pages have specific indicators in the REST API response
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

    // Check if page exists
    if (secData.error) {
      return undefined;
    }

    // Find the Plot section (case-insensitive)
    const plotSection = secData.parse?.sections?.find((s) =>
      /plot/i.test(s.line),
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
    // Silently fail for missing pages
    return undefined;
  }
}

/**
 * Strip HTML tags and clean up Wikipedia markup
 * Removes references, excessive whitespace, and citation markers
 * @param {string} html - Raw HTML content
 * @returns {string} - Cleaned plain text
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ") // Remove all HTML tags
    .replace(/\s+\[\d+\]/g, " ") // Remove reference markers like [1], [2]
    .replace(/\s+\[[a-z]\]/gi, " ") // Remove letter references like [a]
    .replace(/\s{2,}/g, " ") // Collapse multiple spaces
    .trim();
}

/**
 * Normalize title for Wikipedia search
 * Handles special characters and formatting
 * @param {string} title - Original title
 * @returns {string} - Normalized title
 */
function normalizeTitle(title) {
  let normalized = title
    .replace(/\s*x\s*/gi, " × ") // "SPY x FAMILY" → "SPY × FAMILY"
    .trim();

  // Convert all-caps single words to title case for Wikipedia
  // "FROM" → "From", but keep "S.W.A.T." or "SPY × FAMILY" as-is
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
 * Fetch both summary and plot for a title with fallback title resolution
 * Tries multiple Wikipedia title patterns to find the right article
 * Handles redirects by using canonical titles from REST API
 * Skips disambiguation pages automatically
 * @param {string} baseTitle - Base title to search for
 * @param {Object} options - Options for title resolution
 * @param {string} options.year - Release year (optional)
 * @param {string} options.kind - 'movie' or 'tv' (optional)
 * @returns {Promise<{summary: string|undefined, plot: string|undefined, foundTitle: string|undefined}>}
 */
export async function getWikiContent(baseTitle, options = {}) {
  const { year, kind } = options;

  // Normalize title for special characters
  const normalizedTitle = normalizeTitle(baseTitle);

  // Generate title patterns to try, in order of likelihood
  // Most specific patterns first, then fall back to generic ones
  const patterns = [];

  if (kind === "movie") {
    // Movies: Try year-specific first if available
    if (year) {
      patterns.push(`${normalizedTitle} (${year} film)`); // "Interstellar (2014 film)"
    }
    patterns.push(`${normalizedTitle} (film)`); // "Interstellar (film)"

    // Try year-based variants without "film" suffix (some older movies)
    if (year) {
      patterns.push(`${normalizedTitle} (${year})`); // "Casablanca (1942)"
    }
  } else if (kind === "tv") {
    // TV shows need more disambiguation patterns - try most specific first

    // 1. Year + "TV series" (most specific)
    if (year) {
      patterns.push(`${normalizedTitle} (${year} TV series)`); // "The Crown (2016 TV series)"
    }

    // 2. Country-specific (common for international shows)
    patterns.push(`${normalizedTitle} (American TV series)`); // "The Office (American TV series)"
    patterns.push(`${normalizedTitle} (British TV series)`); // "The Office (British TV series)"
    patterns.push(`${normalizedTitle} (U.S. TV series)`); // Alternative US format
    patterns.push(`${normalizedTitle} (UK TV series)`); // Alternative UK format

    // 3. Generic TV series
    patterns.push(`${normalizedTitle} (TV series)`); // "Breaking Bad (TV series)"

    // 4. Year without "TV series" suffix (some older shows)
    if (year) {
      patterns.push(`${normalizedTitle} (${year})`); // "Lost (2004)"
    }
  }

  // Always try normalized title (works for unique titles like "Breaking Bad")
  // But NOT for titles that end in obvious disambiguation patterns
  if (!normalizedTitle.toLowerCase().includes("(disambiguation)")) {
    patterns.push(normalizedTitle);
  }

  // If normalization changed the title, also try original
  if (
    normalizedTitle !== baseTitle &&
    !baseTitle.toLowerCase().includes("(disambiguation)")
  ) {
    patterns.push(baseTitle);
  }

  // Try each pattern until we find content
  const attemptedPatterns = [];

  for (const title of patterns) {
    attemptedPatterns.push(title);

    // Get summary first - this also gives us the canonical title (handles redirects)
    const { summary, canonicalTitle, isDisambiguation } =
      await getWikiSummary(title);

    if (!summary && !canonicalTitle) {
      continue; // Page doesn't exist, try next pattern
    }

    // Skip disambiguation pages - they don't have useful plot information
    if (isDisambiguation) {
      console.log(
        `⚠️  Skipping disambiguation page: "${canonicalTitle || title}"`,
      );
      continue;
    }

    // Double-check content for disambiguation indicators
    // Some pages aren't flagged as disambiguation but contain "may refer to"
    if (summary && summary.toLowerCase().includes("may refer to")) {
      console.log(
        `⚠️  Content suggests disambiguation: "${canonicalTitle || title}"`,
      );
      continue;
    }

    // Use canonical title for Plot section (handles redirects correctly)
    // For example: "Interstellar (2014 film)" redirects to "Interstellar (film)"
    const plot = await getWikiPlotSection(canonicalTitle || title);

    // If we found either summary or plot, use this title
    if (summary || plot) {
      console.log(
        `✅ Found Wikipedia page: "${canonicalTitle || title}" (pattern: "${title}")`,
      );
      return { summary, plot, foundTitle: canonicalTitle || title };
    }
  }

  // No content found with any pattern - log all attempted patterns for debugging
  console.log(
    `❌ No Wikipedia page found for "${baseTitle}" (kind: ${kind || "unknown"})`,
  );
  console.log(
    `   Tried ${attemptedPatterns.length} patterns:`,
    attemptedPatterns.map((p) => `"${p}"`).join(", "),
  );
  return { summary: undefined, plot: undefined, foundTitle: undefined };
}

/**
 * Legacy function for backward compatibility
 * Fetches both summary and plot for a title (simple version)
 * @param {string} title - Wikipedia article title
 * @returns {Promise<{summary: string|undefined, plot: string|undefined}>}
 */
export async function getWikiContentSimple(title) {
  const { summary, canonicalTitle, isDisambiguation } =
    await getWikiSummary(title);

  // Skip disambiguation pages
  if (isDisambiguation) {
    return { summary: undefined, plot: undefined };
  }

  const plot = await getWikiPlotSection(canonicalTitle || title);

  return { summary, plot };
}
