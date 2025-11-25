// Query Expansion Module
// Uses LLM to expand user queries into richer semantic variants before embedding
// This dramatically improves recall by capturing synonyms and related concepts

import "dotenv/config.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout for expansion
  maxRetries: 2,
});

const EXPANSION_TIMEOUT_MS = 30000; // 30 seconds
const DEFAULT_MODEL = "gpt-4o-mini"; // Fast and cheap for expansion

/**
 * LLM prompt for query expansion
 */
const EXPANSION_PROMPT = `You are a media search query expander. Your job is to take a user's search query and expand it into richer semantic variants for three different embedding types.

Your expansions should:
1. Include synonyms and related concepts the user didn't explicitly mention
2. Use domain-specific vocabulary (film/TV terminology)
3. Capture both explicit and implicit user intent
4. Be concise but comprehensive (2-4 sentences per expansion)

EXPANSION TYPES:

1. VIBE: Emotional/atmospheric synonyms and related feelings
   - Focus on: mood, atmosphere, tone, feeling, aesthetic, pacing
   - Examples: "cozy" → "warm, comforting, feel-good, wholesome, heartwarming, low-stakes, gentle pacing"
   - Include: visual style, emotional impact, viewing experience

2. CONTENT: Story/plot/theme related concepts
   - Focus on: narrative themes, plot structures, character types, story beats
   - Examples: "heist" → "elaborate robbery, criminal planning, team assembly, twist endings, high-stakes theft"
   - Include: story arcs, character journeys, narrative devices

3. METADATA: Genres, ratings, directors, time periods, technical aspects
   - Focus on: categorization, factual attributes, creator names, eras
   - Examples: "family-friendly" → "PG, PG-13, wholesome, all-ages, kid-friendly, general audiences"
   - Include: certifications, genres, production details, era-specific terms

Return ONLY valid JSON:
{
  "vibe": "expanded vibe description (2-4 sentences)",
  "content": "expanded content description (2-4 sentences)",
  "metadata": "expanded metadata description (2-4 sentences)"
}

Be creative but stay true to the user's intent. Expand, don't change meaning.`;

/**
 * Expand a search query using LLM
 * @param {string} query - Original user query
 * @param {string} model - OpenAI model to use (default: gpt-4o-mini)
 * @returns {Promise<Object>} - { vibe, content, metadata } expanded texts
 */
export async function expandQuery(query, model = DEFAULT_MODEL) {
  if (!query || query.trim().length === 0) {
    throw new Error("Query cannot be empty");
  }

  const userPrompt = `Expand this media search query: "${query}"`;

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: EXPANSION_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4, // Moderate creativity
      max_tokens: 300, // Keep expansions concise
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Validate response structure
    if (!result.vibe || !result.content || !result.metadata) {
      throw new Error("Invalid expansion response format");
    }

    return {
      vibe: result.vibe.trim(),
      content: result.content.trim(),
      metadata: result.metadata.trim(),
    };
  } catch (error) {
    throw new Error(`Query expansion failed: ${error.message}`);
  }
}

/**
 * Expand query with timeout handling
 * Falls back to original query on timeout or error
 * @param {string} query - Original user query
 * @param {Object} options - Expansion options
 * @returns {Promise<Object>} - Expanded queries or fallback to original
 */
export async function expandQuerySafe(query, options = {}) {
  const {
    model = DEFAULT_MODEL,
    verbose = false,
    fallbackToOriginal = true,
  } = options;

  try {
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Expansion timeout")),
        EXPANSION_TIMEOUT_MS
      )
    );

    // Race expansion against timeout
    const expansionPromise = expandQuery(query, model);
    const result = await Promise.race([expansionPromise, timeoutPromise]);

    if (verbose) {
      console.log("✅ Query expansion successful");
      console.log(`   Vibe: ${result.vibe.substring(0, 80)}...`);
      console.log(`   Content: ${result.content.substring(0, 80)}...`);
      console.log(`   Metadata: ${result.metadata.substring(0, 80)}...`);
    }

    return result;
  } catch (error) {
    if (verbose) {
      console.warn(`⚠️  Query expansion failed: ${error.message}`);
      if (fallbackToOriginal) {
        console.warn("   Falling back to original query");
      }
    }

    if (fallbackToOriginal) {
      // Fallback: use original query for all three types
      return {
        vibe: query,
        content: query,
        metadata: query,
      };
    }

    throw error;
  }
}

/**
 * Batch expand multiple queries
 * Useful for pre-generating expansions for common queries
 * @param {Array<string>} queries - Array of query strings
 * @param {Object} options - Expansion options
 * @returns {Promise<Array>} - Array of expansion results
 */
export async function expandQueries(queries, options = {}) {
  const { delayMs = 1000, verbose = false } = options;

  const results = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];

    if (verbose) {
      console.log(`\n[${i + 1}/${queries.length}] Expanding: "${query}"`);
    }

    try {
      const expansion = await expandQuerySafe(query, { ...options, verbose });
      results.push({
        original: query,
        expansion,
        success: true,
      });
    } catch (error) {
      results.push({
        original: query,
        error: error.message,
        success: false,
      });
    }

    // Rate limiting between expansions
    if (i < queries.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/**
 * Simple in-memory cache for expansions (optional optimization)
 */
class ExpansionCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(query) {
    return this.cache.get(query.toLowerCase().trim());
  }

  set(query, expansion) {
    const key = query.toLowerCase().trim();

    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, expansion);
  }

  has(query) {
    return this.cache.has(query.toLowerCase().trim());
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

// Global cache instance (optional)
export const expansionCache = new ExpansionCache(100);

/**
 * Expand query with caching
 * @param {string} query - Original user query
 * @param {Object} options - Expansion options
 * @returns {Promise<Object>} - Expanded queries (cached or fresh)
 */
export async function expandQueryCached(query, options = {}) {
  const { verbose = false } = options;

  // Check cache first
  if (expansionCache.has(query)) {
    if (verbose) {
      console.log("💾 Using cached expansion");
    }
    return expansionCache.get(query);
  }

  // Generate fresh expansion
  const expansion = await expandQuerySafe(query, options);

  // Cache result
  expansionCache.set(query, expansion);

  return expansion;
}

// Export cache for external management
export { ExpansionCache };
