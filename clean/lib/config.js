/**
 * Centralized Configuration for Enrichment Pipeline
 * All tunable parameters in one place for easy scaling adjustments
 */

export const CONFIG = {
  // Pipeline settings
  pipeline: {
    limit: 15000,                   // Max titles to process per run
    checkpointFrequency: 25,        // Save checkpoint every N titles
    logDirectory: "logs",           // Directory for progress/failure logs
  },

  // Rate limiting settings
  rateLimits: {
    tmdb: {
      delayMs: 250,                 // Delay between TMDB requests
      safeDelayMs: 285,             // Safe delay (3.5 req/sec for free tier)
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
    pageSize: 10000,                // Page size for large queries
  },

  // Embedding generation settings
  embeddings: {
    model: "text-embedding-3-small",
    dimensions: 1536,               // Default dimensions
  },

  // Scaling configuration for large-scale ingestion
  scaling: {
    target: {
      movies: 100000,               // Target number of movies
      tv: 100000,                   // Target number of TV shows
      total: 200000,                // Total target
    },
    discovery: {
      pagesPerRun: 500,             // Max pages per discover query (TMDB limit)
      titlesPerPage: 20,            // Titles returned per page
      popularPagesMovies: 500,      // Pages for popular movies
      popularPagesTv: 500,          // Pages for popular TV shows
      genrePages: 50,               // Pages per genre+year combo
      yearRanges: [
        { start: 2020, end: 2025 },
        { start: 2010, end: 2019 },
        { start: 2000, end: 2009 },
        { start: 1990, end: 1999 },
        { start: 1980, end: 1989 },
        { start: 1970, end: 1979 },
      ],
    },
    ingestion: {
      batchSize: 50,                // Titles per DB batch
      titlesPerRun: 50000,          // Conservative limit per 6-hour run
    },
    rateLimits: {
      tmdb: {
        requestsPerWindow: 40,      // TMDB free tier: 40 req per 10 sec
        windowMs: 10000,            // 10 second window
        safeDelayMs: 285,           // 3.5 req/sec = 285ms between requests
      },
    },
  },
};

export default CONFIG;

