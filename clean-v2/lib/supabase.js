import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getSupabaseKey } from "../config.js";

let client = null;

/**
 * Get or create Supabase client (singleton)
 * @returns {import("@supabase/supabase-js").SupabaseClient}
 */
export function getSupabase() {
  if (!client) {
    client = createClient(getSupabaseUrl(), getSupabaseKey());
  }
  return client;
}

/**
 * Fetch titles from database with optional filters
 * @param {Object} options
 * @param {number} [options.limit] - Max titles to fetch
 * @param {number} [options.offset] - Offset for pagination
 * @param {string} [options.kind] - Filter by 'movie' or 'tv'
 * @param {string[]} [options.ids] - Filter by specific IDs
 * @param {boolean} [options.needsEnrichment] - Filter titles needing enrichment
 * @returns {Promise<Array>}
 */
export async function fetchTitles({ limit, offset = 0, kind, ids, needsEnrichment } = {}) {
  const supabase = getSupabase();

  let query = supabase.from("titles").select("*");

  if (kind) {
    query = query.eq("kind", kind);
  }

  if (ids && ids.length > 0) {
    query = query.in("id", ids);
  }

  if (needsEnrichment) {
    query = query.or("vibes.is.null,vibe_embedding.is.null");
  }

  if (offset > 0) {
    query = query.range(offset, offset + (limit || 1000) - 1);
  } else if (limit) {
    query = query.limit(limit);
  }

  query = query.order("id", { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch titles: ${error.message}`);
  }

  return data || [];
}

/**
 * Separate embedding fields from other updates
 * @param {Object} updates
 * @returns {{regular: Object, embeddings: Object}}
 */
function separateEmbeddings(updates) {
  const embeddingKeys = ["vibe_embedding", "content_embedding", "metadata_embedding"];
  const regular = {};
  const embeddings = {};

  for (const [key, value] of Object.entries(updates)) {
    if (embeddingKeys.includes(key)) {
      embeddings[key] = value;
    } else {
      regular[key] = value;
    }
  }

  return { regular, embeddings };
}

/**
 * Update a single title in the database
 * Splits embedding updates to avoid timeout issues
 * @param {number} id - Title ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
export async function updateTitle(id, updates) {
  const supabase = getSupabase();
  const { regular, embeddings } = separateEmbeddings(updates);

  // Update regular fields first (fast)
  if (Object.keys(regular).length > 0) {
    const { error } = await supabase.from("titles").update(regular).eq("id", id);
    if (error) {
      throw new Error(`Failed to update title ${id}: ${error.message}`);
    }
  }

  // Update embeddings one at a time to avoid timeout
  for (const [key, value] of Object.entries(embeddings)) {
    const { error } = await supabase
      .from("titles")
      .update({ [key]: value })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to update ${key} for title ${id}: ${error.message}`);
    }
  }
}

/**
 * Batch update titles (more efficient for multiple updates)
 * @param {Array<{id: number, updates: Object}>} batch
 * @returns {Promise<{success: number, failed: number}>}
 */
export async function batchUpdateTitles(batch) {
  const supabase = getSupabase();
  let success = 0;
  let failed = 0;

  for (const { id, updates } of batch) {
    const { error } = await supabase.from("titles").update(updates).eq("id", id);

    if (error) {
      failed++;
    } else {
      success++;
    }
  }

  return { success, failed };
}

/**
 * Get total count of titles matching filters
 * @param {Object} options
 * @param {string} [options.kind] - Filter by 'movie' or 'tv'
 * @param {boolean} [options.needsEnrichment] - Filter titles needing enrichment
 * @returns {Promise<number>}
 */
export async function getTitleCount({ kind, needsEnrichment } = {}) {
  const supabase = getSupabase();

  let query = supabase.from("titles").select("id", { count: "exact", head: true });

  if (kind) {
    query = query.eq("kind", kind);
  }

  if (needsEnrichment) {
    query = query.or("vibes.is.null,vibe_embedding.is.null");
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(`Failed to count titles: ${error.message}`);
  }

  return count || 0;
}
