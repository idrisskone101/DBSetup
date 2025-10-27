import { createClient } from "@supabase/supabase-js";

// Extract Supabase URL and create anon key from DATABASE_URL
// DATABASE_URL format: postgresql://postgres:[PASSWORD]@db.PROJECT_REF.supabase.co:5432/postgres
const databaseUrl = process.env.DATABASE_URL;
const match = databaseUrl.match(/db\.([^.]+)\.supabase\.co/);
if (!match) {
  throw new Error("Could not parse Supabase project ref from DATABASE_URL");
}
const projectRef = match[1];
const supabaseUrl = `https://${projectRef}.supabase.co`;

// Note: You'll need to add SUPABASE_ANON_KEY to your .env file
// Get it from: https://supabase.com/dashboard/project/[PROJECT_REF]/settings/api
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
if (!supabaseAnonKey) {
  console.warn(
    "⚠️  SUPABASE_ANON_KEY not found in .env. Attempting to use service role key...",
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  {
    db: {
      schema: "public",
    },
    global: {
      headers: {
        "x-client-info": "supabase-js-node",
      },
    },
    // Increase statement timeout to 5 minutes for large queries
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  },
);

/**
 * Batch upsert titles into Supabase
 * Uses .upsert() which handles ON CONFLICT automatically
 * @param {Array} titles - Array of normalized title objects (max 20 recommended)
 * @param {Array|Object} embeddings - Optional embedding vectors
 *   - If Array: Legacy mode - uses content_embedding column (backward compatible)
 *   - If Object: Multi-embedding mode with { vibe: [], content: [], metadata: [] }
 * @returns {Promise<{success: number, failed: number, errors: Array}>}
 */
export async function batchUpsertTitles(titles, embeddings = null) {
  if (!titles || titles.length === 0) {
    return { success: 0, failed: 0, errors: [] };
  }

  try {
    // Determine embedding mode
    const isMultiEmbedding =
      embeddings &&
      typeof embeddings === "object" &&
      !Array.isArray(embeddings);
    const isLegacyEmbedding = embeddings && Array.isArray(embeddings);

    // Transform titles to match database schema
    const records = titles.map((norm, index) => {
      const record = {
        id: norm.id,
        kind: norm.kind,
        imdb_id: norm.imdb_id || null,
        title: norm.title,
        original_title: norm.original_title || null,
        overview: norm.overview || null,
        release_date: norm.release_date || null,
        runtime_minutes: norm.runtime_minutes || null,
        poster_path: norm.poster_path || null,
        backdrop_path: norm.backdrop_path || null,
        vote_average: norm.vote_average ?? null,
        vote_count: norm.vote_count ?? null,
        popularity: norm.popularity ?? null,
        genres: norm.genres || [],
        languages: norm.languages || [],
        providers: norm.providers || null,
        payload: norm.payload || null,
        updated_at: new Date().toISOString(),
      };

      // Handle multi-embedding mode
      if (isMultiEmbedding) {
        if (embeddings.vibe && embeddings.vibe[index]) {
          record.vibe_embedding = embeddings.vibe[index];
        }
        if (embeddings.content && embeddings.content[index]) {
          record.content_embedding = embeddings.content[index];
        }
        if (embeddings.metadata && embeddings.metadata[index]) {
          record.metadata_embedding = embeddings.metadata[index];
        }
      }
      // Handle legacy embedding mode (backward compatible)
      else if (isLegacyEmbedding && embeddings[index]) {
        record.content_embedding = embeddings[index];
      }

      return record;
    });

    const { data, error } = await supabase.from("titles").upsert(records, {
      onConflict: "id",
      ignoreDuplicates: false, // Update existing records
    });

    if (error) {
      return {
        success: 0,
        failed: titles.length,
        errors: [
          {
            message: error.message,
            details: error.details,
            titles: titles.map((t) => `${t.title} (${t.id})`),
          },
        ],
      };
    }

    return {
      success: titles.length,
      failed: 0,
      errors: [],
    };
  } catch (error) {
    return {
      success: 0,
      failed: titles.length,
      errors: [
        {
          message: error.message,
          titles: titles.map((t) => `${t.title} (${t.id})`),
        },
      ],
    };
  }
}

/**
 * Upsert a single title (fallback for individual processing)
 * @param {Object} norm - Normalized title object
 * @returns {Promise<{success: boolean, error: any}>}
 */
export async function upsertTitle(norm) {
  const result = await batchUpsertTitles([norm]);
  return {
    success: result.success === 1,
    error: result.errors[0] || null,
  };
}
