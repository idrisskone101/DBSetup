import "dotenv/config.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60000, // 60 second timeout
  maxRetries: 2, // Retry failed requests twice
});

/**
 * Generates formatted text for VIBE embedding from a title object
 * Focuses on emotional/atmospheric profile: vibes, tone, pacing, tagline
 * Optimized for "I want something that feels like X" queries
 *
 * CRITICAL: Emphasizes compound phrases to preserve semantic binding
 * (e.g., "dark comedy" should be strongly weighted, not split into "dark" + "comedy")
 *
 * @param {Object} title - Normalized title object
 * @returns {string} - Formatted text for vibe embedding
 */
export function generateVibeEmbeddingText(title) {
  const parts = [];

  // Vibes (atmospheric descriptors) - EMPHASIS ON COMPOUND PHRASES
  if (title.vibes && title.vibes.length > 0) {
    // Repeat compound vibes for stronger semantic binding
    const compoundVibes = title.vibes.filter((v) => v.split(/\s+/).length >= 2);
    const singleWordVibes = title.vibes.filter(
      (v) => v.split(/\s+/).length === 1,
    );

    // Primary vibe list
    parts.push(`Vibes: ${title.vibes.join(", ")}`);

    // Emphasize compounds by repeating them in natural language
    if (compoundVibes.length > 0) {
      parts.push(`This has a ${compoundVibes.join(" and ")} feel`);

      // Extra emphasis for critical compounds like "dark comedy"
      const criticalCompounds = compoundVibes.filter(
        (v) =>
          v.toLowerCase().includes("dark comedy") ||
          v.toLowerCase().includes("psychological") ||
          v.toLowerCase().includes("romantic"),
      );

      if (criticalCompounds.length > 0) {
        parts.push(`Specifically: ${criticalCompounds.join(", ")}`);
      }
    }
  }

  // Tone descriptor (often compound itself)
  if (title.tone) {
    parts.push(`Tone: ${title.tone}`);
  }

  // Pacing descriptor
  if (title.pacing) {
    parts.push(`Pacing: ${title.pacing}`);
  }

  // Tagline (marketing emotional hook)
  if (title.tagline) {
    parts.push(`Tagline: ${title.tagline}`);
  }

  // Fallback if no vibe data available
  if (parts.length === 0) {
    return `${title.title || "Unknown"} - No vibe data available`;
  }

  return parts.join(". ");
}

/**
 * Generates formatted text for CONTENT embedding from a title object
 * Focuses on story/narrative: profile_string, themes, overview, slots, keywords
 * Optimized for "I want a movie about X" or "show me stories like Y" queries
 *
 * @param {Object} title - Normalized title object
 * @returns {string} - Formatted text for content embedding
 */
export function generateContentEmbeddingText(title) {
  const parts = [];

  // Profile string (spoiler-safe logline - PRIMARY)
  if (title.profile_string) {
    parts.push(`Story: ${title.profile_string}`);
  }

  // Themes
  if (title.themes && title.themes.length > 0) {
    parts.push(`Themes: ${title.themes.join(", ")}`);
  }

  // Overview (full plot description)
  if (title.overview && title.overview !== title.profile_string) {
    parts.push(`Overview: ${title.overview}`);
  }

  // Story slots (narrative structure)
  if (title.slots) {
    if (title.slots.protagonist) {
      parts.push(`Protagonist: ${title.slots.protagonist}`);
    }
    if (title.slots.setting_place) {
      parts.push(`Setting: ${title.slots.setting_place}`);
    }
    if (title.slots.setting_time) {
      parts.push(`Time Period: ${title.slots.setting_time}`);
    }
    if (title.slots.goal) {
      parts.push(`Goal: ${title.slots.goal}`);
    }
    if (title.slots.obstacle) {
      parts.push(`Obstacle: ${title.slots.obstacle}`);
    }
    if (title.slots.stakes) {
      parts.push(`Stakes: ${title.slots.stakes}`);
    }
  }

  // Keywords (TMDB narrative tags)
  if (title.keywords && title.keywords.length > 0) {
    const topKeywords = title.keywords.slice(0, 15).join(", ");
    parts.push(`Keywords: ${topKeywords}`);
  }

  // Fallback if no content data available
  if (parts.length === 0) {
    return `${title.title || "Unknown"} - No story data available`;
  }

  return parts.join(". ");
}

/**
 * Generates formatted text for METADATA embedding from a title object
 * Focuses on factual/categorical data: genres, director, writers, certification, countries, collection
 * Optimized for filtering-style queries like "90s sci-fi directed by X" or "R-rated thrillers"
 *
 * @param {Object} title - Normalized title object
 * @returns {string} - Formatted text for metadata embedding
 */
export function generateMetadataEmbeddingText(title) {
  const parts = [];

  // Type (movie vs tv)
  parts.push(`Type: ${title.kind || "unknown"}`);

  // Genres
  if (title.genres && title.genres.length > 0) {
    parts.push(`Genres: ${title.genres.join(", ")}`);
  }

  // Director (movies) or Creators (TV shows)
  if (title.director) {
    parts.push(`Director: ${title.director}`);
  } else if (title.creators && title.creators.length > 0) {
    parts.push(`Creators: ${title.creators.join(", ")}`);
  }

  // Writers (top 3)
  if (title.writers && title.writers.length > 0) {
    const topWriters = title.writers.slice(0, 3).join(", ");
    parts.push(`Writers: ${topWriters}`);
  }

  // Certification (age rating)
  if (title.certification) {
    parts.push(`Rating: ${title.certification}`);
  }

  // Production countries
  if (title.production_countries && title.production_countries.length > 0) {
    parts.push(`Countries: ${title.production_countries.join(", ")}`);
  }

  // Collection/franchise
  if (title.collection_name) {
    parts.push(`Collection: ${title.collection_name}`);
  }

  // Release year
  if (title.release_date) {
    const year = title.release_date.split("-")[0];
    parts.push(`Released: ${year}`);
  }

  // Runtime
  if (title.runtime_minutes) {
    parts.push(`Runtime: ${title.runtime_minutes} minutes`);
  }

  // Vote average (quality signal)
  // if (title.vote_average != null) {
  //   parts.push(`Vote Average: ${title.vote_average}/10`);
  // }

  return parts.join(". ");
}

/**
 * Generates formatted text for embedding from a title object
 * Combines all relevant metadata into a structured text format
 * Includes: Wikipedia enrichment (profile, themes, vibes, tone, pacing, slots)
 *           + TMDB enrichment (cast, director, writers, creators, keywords, collection, certification)
 *
 * DO NOT RUN EMBEDDINGS UNTIL ALL DATA ENRICHMENT IS COMPLETE!
 *
 * NOTE: This is the LEGACY function for backward compatibility.
 * For new implementations, use the specialized functions:
 * - generateVibeEmbeddingText() for emotional/atmospheric
 * - generateContentEmbeddingText() for story/narrative
 * - generateMetadataEmbeddingText() for factual/categorical
 *
 * @param {Object} title - Normalized title object
 * @returns {string} - Formatted text for embedding
 */
export function generateEmbeddingText(title) {
  const parts = [];

  // Core fields
  if (title.title) {
    parts.push(`Title: ${title.title}`);
  }

  if (title.original_title && title.original_title !== title.title) {
    parts.push(`Original Title: ${title.original_title}`);
  }

  // Enriched profile string (spoiler-safe logline from Wikipedia)
  if (title.profile_string) {
    parts.push(`Profile: ${title.profile_string}`);
  }

  // Original overview (if available and different from profile)
  if (title.overview && title.overview !== title.profile_string) {
    parts.push(`Overview: ${title.overview}`);
  }

  // TMDB tagline (marketing one-liner)
  if (title.tagline) {
    parts.push(`Tagline: ${title.tagline}`);
  }

  // Story slots (rich narrative elements)
  if (title.slots) {
    if (title.slots.protagonist) {
      parts.push(`Protagonist: ${title.slots.protagonist}`);
    }
    if (title.slots.setting_place) {
      parts.push(`Setting: ${title.slots.setting_place}`);
    }
    if (title.slots.setting_time) {
      parts.push(`Time Period: ${title.slots.setting_time}`);
    }
    if (title.slots.goal) {
      parts.push(`Goal: ${title.slots.goal}`);
    }
    if (title.slots.obstacle) {
      parts.push(`Obstacle: ${title.slots.obstacle}`);
    }
    if (title.slots.stakes) {
      parts.push(`Stakes: ${title.slots.stakes}`);
    }
  }

  // Themes (semantic concepts from Wikipedia)
  if (title.themes && title.themes.length > 0) {
    parts.push(`Themes: ${title.themes.join(", ")}`);
  }

  // Vibes (atmospheric descriptors from Wikipedia)
  if (title.vibes && title.vibes.length > 0) {
    parts.push(`Vibes: ${title.vibes.join(", ")}`);
  }

  // Tone and pacing (from Wikipedia)
  if (title.tone) {
    parts.push(`Tone: ${title.tone}`);
  }

  if (title.pacing) {
    parts.push(`Pacing: ${title.pacing}`);
  }

  // TMDB Entity Data (people who drive taste)
  // Top 5 cast members (high-value signal for recommendations)
  if (title.cast && Array.isArray(title.cast) && title.cast.length > 0) {
    const topCast = title.cast
      .slice(0, 5)
      .map((member) => {
        if (member.character) {
          return `${member.name} as ${member.character}`;
        }
        return member.name;
      })
      .join(", ");
    parts.push(`Cast: ${topCast}`);
  }

  // Director (critical for movie taste)
  if (title.director) {
    parts.push(`Director: ${title.director}`);
  }

  // Writers (up to 3 for embedding)
  if (title.writers && title.writers.length > 0) {
    const topWriters = title.writers.slice(0, 3).join(", ");
    parts.push(`Writers: ${topWriters}`);
  }

  // Creators (TV shows only)
  if (title.creators && title.creators.length > 0) {
    parts.push(`Creators: ${title.creators.join(", ")}`);
  }

  // Collection/Franchise (e.g., "Marvel Cinematic Universe")
  if (title.collection_name) {
    parts.push(`Collection: ${title.collection_name}`);
  }

  // TMDB Keywords (top 10 for semantic matching)
  if (title.keywords && title.keywords.length > 0) {
    const topKeywords = title.keywords.slice(0, 10).join(", ");
    parts.push(`Keywords: ${topKeywords}`);
  }

  // Certification (family-friendly vs mature content context)
  if (title.certification) {
    // Add context for age rating
    const isFamilyFriendly = [
      "G",
      "PG",
      "PG-13",
      "TV-G",
      "TV-PG",
      "TV-14",
    ].includes(title.certification);
    const certContext = isFamilyFriendly ? "family-friendly" : "mature content";
    parts.push(`Certification: ${title.certification} (${certContext})`);
  }

  // Basic metadata
  if (title.genres && title.genres.length > 0) {
    parts.push(`Genres: ${title.genres.join(", ")}`);
  }

  if (title.languages && title.languages.length > 0) {
    parts.push(`Languages: ${title.languages.join(", ")}`);
  }

  parts.push(`Type: ${title.kind || "unknown"}`);

  if (title.release_date) {
    parts.push(`Release Date: ${title.release_date}`);
  }

  // if (title.vote_average != null) {
  //   parts.push(`Rating: ${title.vote_average}/10`);
  // }

  // if (title.popularity != null) {
  //   parts.push(`Popularity: ${title.popularity}`);
  // }

  if (title.runtime_minutes) {
    parts.push(`Runtime: ${title.runtime_minutes} minutes`);
  }

  return parts.join("\n");
}

/**
 * Generate embeddings for a batch of titles using OpenAI API
 * Supports up to 2048 items per batch for cost optimization
 * @param {Array} titles - Array of normalized title objects
 * @returns {Promise<Array>} - Array of embedding vectors (same order as input)
 */
export async function generateEmbeddings(titles) {
  if (!titles || titles.length === 0) {
    return [];
  }

  // OpenAI allows up to 2048 inputs per request
  if (titles.length > 2048) {
    console.warn(
      `⚠️  Batch size ${titles.length} exceeds OpenAI limit of 2048. Processing in chunks...`,
    );
    return await generateEmbeddingsInChunks(titles, 2048);
  }

  try {
    // Generate embedding text for each title
    const inputs = titles.map((title) => generateEmbeddingText(title));

    console.log(
      `🤖 Generating embeddings for ${titles.length} title(s) using OpenAI...`,
    );

    // Call OpenAI embeddings API
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: inputs,
      encoding_format: "float", // Default format (uses full 1536 dimensions)
    });

    // Extract embeddings from response
    const embeddings = response.data.map((item) => item.embedding);

    console.log(`✅ Successfully generated ${embeddings.length} embeddings`);

    return embeddings;
  } catch (error) {
    console.error("❌ Error generating embeddings:", error.message);

    // Return null embeddings on error (graceful fallback)
    return titles.map(() => null);
  }
}

/**
 * Generate embeddings in chunks to handle large batches
 * @param {Array} titles - Array of normalized title objects
 * @param {number} chunkSize - Maximum chunk size (default 2048)
 * @returns {Promise<Array>} - Array of embedding vectors
 */
async function generateEmbeddingsInChunks(titles, chunkSize = 2048) {
  const allEmbeddings = [];

  for (let i = 0; i < titles.length; i += chunkSize) {
    const chunk = titles.slice(i, i + chunkSize);
    console.log(
      `📦 Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(titles.length / chunkSize)}...`,
    );

    const embeddings = await generateEmbeddings(chunk);
    allEmbeddings.push(...embeddings);

    // Small delay between chunks to avoid rate limiting
    if (i + chunkSize < titles.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return allEmbeddings;
}

/**
 * Generate embeddings with retry logic for failed batches
 * @param {Array} titles - Array of normalized title objects
 * @param {number} maxRetries - Maximum number of retries (default 3)
 * @returns {Promise<Array>} - Array of embedding vectors
 */
export async function generateEmbeddingsWithRetry(titles, maxRetries = 3) {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      return await generateEmbeddings(titles);
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        console.error(
          `❌ Failed to generate embeddings after ${maxRetries} attempts`,
        );
        throw error;
      }

      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      console.warn(`⚠️  Attempt ${attempt} failed. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Generate VIBE embeddings for a batch of titles using OpenAI API
 * Focuses on emotional/atmospheric profile: vibes, tone, pacing, tagline
 * @param {Array} titles - Array of normalized title objects
 * @returns {Promise<Array>} - Array of embedding vectors (same order as input)
 */
export async function generateVibeEmbeddings(titles) {
  if (!titles || titles.length === 0) {
    return [];
  }

  if (titles.length > 2048) {
    console.warn(
      `⚠️  Batch size ${titles.length} exceeds OpenAI limit of 2048. Processing in chunks...`,
    );
    return await generateEmbeddingsInChunks(
      titles,
      2048,
      generateVibeEmbeddingText,
    );
  }

  try {
    const inputs = titles.map((title) => generateVibeEmbeddingText(title));

    console.log(
      `🎭 Generating VIBE embeddings for ${titles.length} title(s)...`,
    );

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: inputs,
      encoding_format: "float", // Default format (uses full 1536 dimensions)
    });

    const embeddings = response.data.map((item) => item.embedding);
    console.log(
      `✅ Successfully generated ${embeddings.length} vibe embeddings`,
    );

    return embeddings;
  } catch (error) {
    console.error("❌ Error generating vibe embeddings:", error.message);
    return titles.map(() => null);
  }
}

/**
 * Generate CONTENT embeddings for a batch of titles using OpenAI API
 * Focuses on story/narrative: profile_string, themes, overview, slots, keywords
 * @param {Array} titles - Array of normalized title objects
 * @returns {Promise<Array>} - Array of embedding vectors (same order as input)
 */
export async function generateContentEmbeddings(titles) {
  if (!titles || titles.length === 0) {
    return [];
  }

  if (titles.length > 2048) {
    console.warn(
      `⚠️  Batch size ${titles.length} exceeds OpenAI limit of 2048. Processing in chunks...`,
    );
    return await generateEmbeddingsInChunks(
      titles,
      2048,
      generateContentEmbeddingText,
    );
  }

  try {
    const inputs = titles.map((title) => generateContentEmbeddingText(title));

    console.log(
      `📖 Generating CONTENT embeddings for ${titles.length} title(s)...`,
    );

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: inputs,
      encoding_format: "float", // Default format (uses full 1536 dimensions)
    });

    const embeddings = response.data.map((item) => item.embedding);
    console.log(
      `✅ Successfully generated ${embeddings.length} content embeddings`,
    );

    return embeddings;
  } catch (error) {
    console.error("❌ Error generating content embeddings:", error.message);
    return titles.map(() => null);
  }
}

/**
 * Generate METADATA embeddings for a batch of titles using OpenAI API
 * Focuses on factual/categorical data: genres, director, writers, certification, countries, collection
 * @param {Array} titles - Array of normalized title objects
 * @returns {Promise<Array>} - Array of embedding vectors (same order as input)
 */
export async function generateMetadataEmbeddings(titles) {
  if (!titles || titles.length === 0) {
    return [];
  }

  if (titles.length > 2048) {
    console.warn(
      `⚠️  Batch size ${titles.length} exceeds OpenAI limit of 2048. Processing in chunks...`,
    );
    return await generateEmbeddingsInChunks(
      titles,
      2048,
      generateMetadataEmbeddingText,
    );
  }

  try {
    const inputs = titles.map((title) => generateMetadataEmbeddingText(title));

    console.log(
      `🏷️  Generating METADATA embeddings for ${titles.length} title(s)...`,
    );

    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: inputs,
      encoding_format: "float", // Default format (uses full 1536 dimensions)
    });

    const embeddings = response.data.map((item) => item.embedding);
    console.log(
      `✅ Successfully generated ${embeddings.length} metadata embeddings`,
    );

    return embeddings;
  } catch (error) {
    console.error("❌ Error generating metadata embeddings:", error.message);
    return titles.map(() => null);
  }
}

/**
 * Generate all three types of embeddings (vibe, content, metadata) for titles
 * Returns an array of objects with { vibe, content, metadata } properties
 * @param {Array} titles - Array of title objects
 * @returns {Promise<Array<{vibe: Array, content: Array, metadata: Array}>>}
 */
export async function generateMultiEmbeddings(titles) {
  if (!titles || titles.length === 0) {
    return [];
  }

  console.log(
    `🎨 Generating multi-embeddings for ${titles.length} title(s)...`,
  );

  try {
    // Generate all three embedding types in parallel
    const [vibeEmbeddings, contentEmbeddings, metadataEmbeddings] =
      await Promise.all([
        generateVibeEmbeddings(titles),
        generateContentEmbeddings(titles),
        generateMetadataEmbeddings(titles),
      ]);

    // Combine into objects
    const combined = titles.map((title, index) => ({
      vibe: vibeEmbeddings[index],
      content: contentEmbeddings[index],
      metadata: metadataEmbeddings[index],
    }));

    console.log(`✅ Generated multi-embeddings for ${titles.length} titles`);
    return combined;
  } catch (error) {
    console.error("❌ Error generating multi-embeddings:", error.message);
    throw error;
  }
}
