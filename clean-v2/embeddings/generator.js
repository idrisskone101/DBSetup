/**
 * Generate embeddings for titles
 */

import { generateEmbeddingsBatch } from "../enrichment/openai-client.js";
import { buildVibeText, buildContentText, buildMetadataText } from "./text-builders.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("[Embed]");

/**
 * Generate all three embeddings for a batch of titles
 * @param {Array} titles - Array of title objects
 * @returns {Promise<Map<number, {vibe: number[], content: number[], metadata: number[]}>>}
 */
export async function generateEmbeddingsForTitles(titles) {
  if (titles.length === 0) {
    return new Map();
  }

  log.info(`Generating embeddings for ${titles.length} titles`);

  // Build texts for each embedding type
  const vibeTexts = [];
  const contentTexts = [];
  const metadataTexts = [];
  const titleIds = [];

  for (const title of titles) {
    titleIds.push(title.id);
    vibeTexts.push(buildVibeText(title));
    contentTexts.push(buildContentText(title));
    metadataTexts.push(buildMetadataText(title));
  }

  // Generate all embeddings in parallel
  log.debug("Generating vibe embeddings...");
  const vibeEmbeddings = await generateEmbeddingsBatch(vibeTexts);

  log.debug("Generating content embeddings...");
  const contentEmbeddings = await generateEmbeddingsBatch(contentTexts);

  log.debug("Generating metadata embeddings...");
  const metadataEmbeddings = await generateEmbeddingsBatch(metadataTexts);

  // Map results to title IDs
  const results = new Map();

  for (let i = 0; i < titleIds.length; i++) {
    results.set(titleIds[i], {
      vibe: vibeEmbeddings[i] || null,
      content: contentEmbeddings[i] || null,
      metadata: metadataEmbeddings[i] || null,
    });
  }

  log.info(`Generated embeddings for ${results.size} titles`);

  return results;
}

/**
 * Generate embeddings for a single title
 * @param {Object} title - Title object
 * @returns {Promise<{vibe: number[]|null, content: number[]|null, metadata: number[]|null}>}
 */
export async function generateEmbeddingsForTitle(title) {
  const results = await generateEmbeddingsForTitles([title]);
  return results.get(title.id) || { vibe: null, content: null, metadata: null };
}

/**
 * Check if a title needs embedding generation
 * @param {Object} title - Title object
 * @returns {boolean}
 */
export function needsEmbeddings(title) {
  return (
    !title.vibe_embedding ||
    !title.content_embedding ||
    !title.metadata_embedding
  );
}

/**
 * Process titles in chunks for embedding generation
 * @param {Array} titles - Array of title objects
 * @param {number} chunkSize - Number of titles per chunk
 * @param {Function} [onChunk] - Callback after each chunk
 * @returns {AsyncGenerator<{id: number, embeddings: Object}>}
 */
export async function* generateEmbeddingsChunked(titles, chunkSize = 50, onChunk) {
  for (let i = 0; i < titles.length; i += chunkSize) {
    const chunk = titles.slice(i, i + chunkSize);

    log.info(`Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(titles.length / chunkSize)}`);

    const embeddingsMap = await generateEmbeddingsForTitles(chunk);

    for (const title of chunk) {
      const embeddings = embeddingsMap.get(title.id);
      if (embeddings) {
        yield { id: title.id, embeddings };
      }
    }

    if (onChunk) {
      onChunk(i + chunk.length, titles.length);
    }
  }
}
