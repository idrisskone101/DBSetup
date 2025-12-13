/**
 * Database Utilities
 * Safe database operations with retry logic, timeout handling, and batch processing
 */

import { createClient } from "@supabase/supabase-js";

// Default configuration
const DEFAULT_CONFIG = {
  timeout: 30000,        // 30 second query timeout
  maxRetries: 3,         // Maximum retry attempts
  batchSize: 50,         // Default batch size for upserts
  retryDelays: [1000, 2000, 4000], // Exponential backoff delays
  pageSize: 10000,       // Page size for fetching large datasets
};

/**
 * Create a configured Supabase client
 * @param {Object} options - Client options
 * @returns {Object} Supabase client
 */
export function createSupabaseClient(options = {}) {
  const url = options.url || process.env.SUPABASE_URL;
  const key = options.key || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
    db: { schema: "public" },
  });
}

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Categorize database errors for appropriate handling
 * @param {Error} error - The error to categorize
 * @returns {Object} Error category and details
 */
export function categorizeDbError(error) {
  const message = error.message?.toLowerCase() || "";
  const code = error.code || "";

  if (message.includes("timeout") || message.includes("timed out") || code === "ETIMEDOUT") {
    return { type: "timeout", retryable: true, reduceLoad: true };
  }

  if (message.includes("connection") || message.includes("network") || code === "ECONNRESET") {
    return { type: "connection", retryable: true, reduceLoad: false };
  }

  if (message.includes("rate limit") || code === "429") {
    return { type: "rate_limit", retryable: true, reduceLoad: true };
  }

  if (message.includes("duplicate key") || code === "23505") {
    return { type: "duplicate", retryable: false, reduceLoad: false };
  }

  if (message.includes("violates check constraint")) {
    return { type: "constraint", retryable: false, reduceLoad: false };
  }

  return { type: "unknown", retryable: false, reduceLoad: false };
}

/**
 * Execute a function with retry logic and exponential backoff
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @returns {Promise<any>} Result of the function
 */
export async function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? DEFAULT_CONFIG.maxRetries;
  const delays = options.retryDelays ?? DEFAULT_CONFIG.retryDelays;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const { retryable, reduceLoad } = categorizeDbError(error);

      if (!retryable || attempt === maxRetries) {
        throw error;
      }

      const delay = delays[Math.min(attempt, delays.length - 1)];
      console.log(`  ⏳ Retry ${attempt + 1}/${maxRetries} after ${delay}ms (${error.message})`);
      await sleep(delay);

      // If we should reduce load, signal to caller
      if (reduceLoad && options.onReduceLoad) {
        options.onReduceLoad();
      }
    }
  }

  throw lastError;
}

/**
 * Fetch all IDs from a table with pagination to avoid timeouts
 * @param {Object} supabase - Supabase client
 * @param {string} table - Table name
 * @param {Object} options - Fetch options
 * @returns {Promise<Set<number>>} Set of all IDs
 */
export async function fetchAllIds(supabase, table, options = {}) {
  const { kind, pageSize = DEFAULT_CONFIG.pageSize } = options;
  const allIds = new Set();
  let hasMore = true;
  let offset = 0;

  console.log(`📥 Fetching existing IDs from ${table}...`);

  while (hasMore) {
    const fetchPage = async () => {
      let query = supabase
        .from(table)
        .select("id")
        .range(offset, offset + pageSize - 1);

      if (kind) {
        query = query.eq("kind", kind);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    };

    const data = await withRetry(fetchPage, { maxRetries: 3 });

    data.forEach((row) => allIds.add(row.id));

    if (data.length < pageSize) {
      hasMore = false;
    } else {
      offset += pageSize;
      process.stdout.write(`\r  Fetched ${allIds.size.toLocaleString()} IDs...`);
    }
  }

  console.log(`\r✓ Fetched ${allIds.size.toLocaleString()} IDs from ${table}`);
  return allIds;
}

/**
 * Batch upsert rows with retry logic and adaptive batch sizing
 * @param {Object} supabase - Supabase client
 * @param {string} table - Table name
 * @param {Array} rows - Rows to upsert
 * @param {Object} options - Upsert options
 * @returns {Promise<{success: number, failed: number, errors: Array}>}
 */
export async function batchUpsert(supabase, table, rows, options = {}) {
  if (!rows || rows.length === 0) {
    return { success: 0, failed: 0, errors: [] };
  }

  const {
    batchSize = DEFAULT_CONFIG.batchSize,
    onConflict = "id",
    ignoreDuplicates = false,
    onProgress,
  } = options;

  let currentBatchSize = batchSize;
  let success = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i += currentBatchSize) {
    const batch = rows.slice(i, i + currentBatchSize);

    const upsertBatch = async () => {
      const { data, error } = await supabase
        .from(table)
        .upsert(batch, {
          onConflict,
          ignoreDuplicates,
        });

      if (error) throw error;
      return data;
    };

    try {
      await withRetry(upsertBatch, {
        maxRetries: 3,
        onReduceLoad: () => {
          // Reduce batch size on timeout/rate limit
          currentBatchSize = Math.max(10, Math.floor(currentBatchSize / 2));
          console.log(`  📉 Reduced batch size to ${currentBatchSize}`);
        },
      });

      success += batch.length;

      if (onProgress) {
        onProgress({ processed: i + batch.length, total: rows.length, success, failed });
      }
    } catch (error) {
      failed += batch.length;
      errors.push({
        batchStart: i,
        batchEnd: i + batch.length,
        error: error.message,
      });
      console.error(`  ❌ Batch ${i}-${i + batch.length} failed: ${error.message}`);
    }
  }

  return { success, failed, errors };
}

/**
 * Update rows with retry logic
 * @param {Object} supabase - Supabase client
 * @param {string} table - Table name
 * @param {Object} data - Data to update
 * @param {Object} filter - Filter conditions
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function safeUpdate(supabase, table, data, filter) {
  const updateFn = async () => {
    let query = supabase.from(table).update(data);

    Object.entries(filter).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        query = query.in(key, value);
      } else {
        query = query.eq(key, value);
      }
    });

    const { error } = await query;
    if (error) throw error;
  };

  try {
    await withRetry(updateFn, { maxRetries: 3 });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Count rows in a table with optional filters
 * @param {Object} supabase - Supabase client
 * @param {string} table - Table name
 * @param {Object} filter - Filter conditions
 * @returns {Promise<number>} Row count
 */
export async function countRows(supabase, table, filter = {}) {
  const countFn = async () => {
    let query = supabase.from(table).select("*", { count: "exact", head: true });

    Object.entries(filter).forEach(([key, value]) => {
      if (value === null) {
        query = query.is(key, null);
      } else {
        query = query.eq(key, value);
      }
    });

    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  };

  return withRetry(countFn, { maxRetries: 3 });
}

export default {
  createSupabaseClient,
  sleep,
  categorizeDbError,
  withRetry,
  fetchAllIds,
  batchUpsert,
  safeUpdate,
  countRows,
  DEFAULT_CONFIG,
};
