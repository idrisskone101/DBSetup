/**
 * Centralized Configuration for Enrichment Pipeline
 * All tunable parameters in one place for easy scaling adjustments
 */

export const CONFIG = {
  // Pipeline settings
  pipeline: {
    limit: 6000,                    // Max titles to process per run
    checkpointFrequency: 25,        // Save checkpoint every N titles
    logDirectory: "logs",           // Directory for progress/failure logs
  },

  // Rate limiting settings
  rateLimits: {
    tmdb: {
      delayMs: 250,                 // Delay between TMDB requests
      maxRetries: 3,                // Max retry attempts
      backoffMultiplier: 2,         // Exponential backoff multiplier
    },
    wikipedia: {
      delayMs: 500,                 // Delay between Wikipedia requests
      maxRetries: 2,                // Max retry attempts
      backoffMultiplier: 1.5,       // Exponential backoff multiplier
    },
    openai: {
      embeddingBatchSize: 500,      // Texts per embedding API call
      llmDelayMs: 100,              // Delay between LLM calls
      maxRetries: 2,                // Max retry attempts
      delayBetweenBatches: 1000,    // Delay between embedding batches
    },
  },

  // Database settings
  database: {
    upsertBatchSize: 50,            // Titles per batch upsert
    queryTimeoutMs: 30000,          // Query timeout
  },

  // Embedding generation settings
  embeddings: {
    model: "text-embedding-3-small",
    dimensions: 1536,               // Default dimensions
  },
};

export default CONFIG;

