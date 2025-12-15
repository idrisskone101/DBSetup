/**
 * Central configuration for all pipeline components
 */
export const config = {
  tmdb: {
    baseUrl: "https://api.themoviedb.org/3",
    rateLimit: {
      requestsPerSecond: 2,
      delayMs: 500,
    },
    retries: 3,
    timeout: 30000,
  },

  wikipedia: {
    baseUrl: "https://en.wikipedia.org/api/rest_v1",
    searchUrl: "https://en.wikipedia.org/w/api.php",
    minConfidence: 0.7,
    rateLimit: {
      delayMs: 200,
    },
  },

  openai: {
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    chatModel: "gpt-4o-mini",
    batchSize: 500,
    delayBetweenBatches: 1000,
    retries: 2,
  },

  pipeline: {
    defaultBatchSize: 1000,
    checkpointInterval: 100,
    logDir: "clean-v2/logs",
  },
};

// Environment variable getters
export function getTMDBToken() {
  const token = process.env.TMDB_TOKEN;
  if (!token) throw new Error("TMDB_TOKEN environment variable is required");
  return token;
}

export function getOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY environment variable is required");
  return key;
}

export function getSupabaseUrl() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL environment variable is required");
  return url;
}

export function getSupabaseKey() {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error("SUPABASE_ANON_KEY environment variable is required");
  return key;
}
