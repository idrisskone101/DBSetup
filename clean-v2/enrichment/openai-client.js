/**
 * OpenAI client for chat and embeddings
 */

import OpenAI from "openai";
import { config, getOpenAIKey } from "../config.js";
import { retry } from "../lib/retry.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("[OpenAI]");

let client = null;

/**
 * Get or create OpenAI client (singleton)
 * @returns {OpenAI}
 */
export function getOpenAIClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: getOpenAIKey(),
      timeout: 60000,
      maxRetries: config.openai.retries,
    });
  }
  return client;
}

/**
 * Send a chat completion request
 * @param {string} systemPrompt - System prompt
 * @param {string} userPrompt - User prompt
 * @param {Object} options
 * @param {number} [options.temperature=0.3] - Temperature
 * @param {number} [options.maxTokens=1000] - Max tokens
 * @returns {Promise<string>}
 */
export async function chatCompletion(systemPrompt, userPrompt, { temperature = 0.3, maxTokens = 1000 } = {}) {
  const openai = getOpenAIClient();

  const response = await retry(
    async () => {
      return openai.chat.completions.create({
        model: config.openai.chatModel,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
    },
    {
      maxRetries: config.openai.retries,
      onRetry: (error, attempt, waitTime) => {
        log.warn(`Chat retry ${attempt} after ${waitTime}ms`, { error: error.message });
      },
    }
  );

  return response.choices[0]?.message?.content || "";
}

/**
 * Generate embeddings for a batch of texts
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
export async function generateEmbeddingsBatch(texts) {
  if (texts.length === 0) return [];

  const openai = getOpenAIClient();

  // Process in chunks
  const chunks = [];
  for (let i = 0; i < texts.length; i += config.openai.batchSize) {
    chunks.push(texts.slice(i, i + config.openai.batchSize));
  }

  const allEmbeddings = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    log.debug(`Processing embedding batch ${i + 1}/${chunks.length} (${chunk.length} texts)`);

    const response = await retry(
      async () => {
        return openai.embeddings.create({
          model: config.openai.embeddingModel,
          input: chunk,
          dimensions: config.openai.embeddingDimensions,
          encoding_format: "float",
        });
      },
      {
        maxRetries: config.openai.retries,
        onRetry: (error, attempt, waitTime) => {
          log.warn(`Embedding retry ${attempt} after ${waitTime}ms`, { error: error.message });
        },
      }
    );

    // Extract embeddings in order
    const embeddings = response.data.map((item) => item.embedding);
    allEmbeddings.push(...embeddings);

    // Delay between batches
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, config.openai.delayBetweenBatches));
    }
  }

  return allEmbeddings;
}

/**
 * Generate a single embedding
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
  const embeddings = await generateEmbeddingsBatch([text]);
  return embeddings[0] || [];
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 * @param {string} response - LLM response
 * @returns {Object|null}
 */
export function parseJsonResponse(response) {
  if (!response) return null;

  // Try direct parse first
  try {
    return JSON.parse(response);
  } catch {
    // Try to extract from markdown code block
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // Fall through
      }
    }

    // Try to find JSON object in response
    const objectMatch = response.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // Fall through
      }
    }
  }

  return null;
}
