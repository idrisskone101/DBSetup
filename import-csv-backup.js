import "dotenv/config.js";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { parse } from "csv-parse";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
);

const CSV_FILE =
  "/Users/idrisskone/Documents/GitHub/DBSetup/titles_rows copy.csv";
const BATCH_SIZE = 50; // Process in smaller batches due to large embedding data

/**
 * Parse array string from CSV (handles PostgreSQL array format)
 */
function parseArray(str) {
  if (!str || str === "\\N" || str === "") return null;

  // Handle PostgreSQL array format: {"item1","item2"}
  if (str.startsWith("{") && str.endsWith("}")) {
    const content = str.slice(1, -1);
    if (!content) return [];

    // Split by comma but handle quoted strings
    const items = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        items.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (current) items.push(current.trim());

    return items.map((item) => item.replace(/^"|"$/g, ""));
  }

  return null;
}

/**
 * Parse JSON string from CSV (handles JSONB columns)
 */
function parseJSON(str) {
  if (!str || str === "\\N" || str === "") return null;

  try {
    return JSON.parse(str);
  } catch (error) {
    console.warn("Failed to parse JSON:", str.substring(0, 100));
    return null;
  }
}

/**
 * Parse vector/embedding from CSV (converts string array to float array)
 */
function parseEmbedding(str) {
  if (!str || str === "\\N" || str === "") return null;

  try {
    // Handle array format: [0.1,0.2,0.3,...]
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Convert to float array and verify dimensions
      const embedding = parsed.map((v) => parseFloat(v));
      console.log(`  Parsed embedding with ${embedding.length} dimensions`);
      return embedding;
    }
    return null;
  } catch (error) {
    console.warn("Failed to parse embedding:", error.message);
    return null;
  }
}

/**
 * Parse a single row from CSV and convert to database format
 */
function parseRow(row) {
  return {
    id: row.id ? parseInt(row.id) : null,
    kind: row.kind || null,
    imdb_id: row.imdb_id || null,
    title: row.title || null,
    original_title: row.original_title || null,
    overview: row.overview || null,
    release_date: row.release_date || null,
    runtime_minutes: row.runtime_minutes ? parseInt(row.runtime_minutes) : null,
    poster_path: row.poster_path || null,
    backdrop_path: row.backdrop_path || null,
    vote_average: row.vote_average ? parseFloat(row.vote_average) : null,
    vote_count: row.vote_count ? parseInt(row.vote_count) : null,
    popularity: row.popularity ? parseFloat(row.popularity) : null,
    genres: parseArray(row.genres),
    languages: parseArray(row.languages),
    providers: parseJSON(row.providers),
    payload: parseJSON(row.payload),
    content_embedding: parseEmbedding(row.content_embedding),
    profile_string: row.profile_string || null,
    vibes: parseArray(row.vibes),
    themes: parseArray(row.themes),
    pacing: row.pacing || null,
    tone: row.tone || null,
    wiki_source_url: row.wiki_source_url || null,
    slots: parseJSON(row.slots),
    cast: parseJSON(row.cast),
    director: row.director || null,
    writers: parseArray(row.writers),
    creators: parseArray(row.creators),
    collection_id: row.collection_id ? parseInt(row.collection_id) : null,
    collection_name: row.collection_name || null,
    certification: row.certification || null,
    production_countries: parseArray(row.production_countries),
    keywords: parseArray(row.keywords),
    tagline: row.tagline || null,
    vibe_embedding: parseEmbedding(row.vibe_embedding),
    metadata_embedding: parseEmbedding(row.metadata_embedding),
  };
}

/**
 * Import CSV data into Supabase in batches
 */
async function importCSV() {
  console.log(`\n📂 Reading CSV file: ${CSV_FILE}`);

  const rows = [];
  let processedCount = 0;
  let errorCount = 0;

  // Read and parse CSV
  const parser = fs.createReadStream(CSV_FILE).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true, // Handle variable column counts
    }),
  );

  for await (const row of parser) {
    try {
      const parsed = parseRow(row);
      rows.push(parsed);

      // Process in batches
      if (rows.length >= BATCH_SIZE) {
        console.log(`\n📦 Processing batch of ${rows.length} titles...`);
        const { data, error } = await supabase
          .from("titles")
          .upsert(rows, { onConflict: "id" });

        if (error) {
          console.error("❌ Batch insert error:", error.message);
          errorCount += rows.length;
        } else {
          processedCount += rows.length;
          console.log(`✅ Imported ${processedCount} titles so far`);
        }

        rows.length = 0; // Clear batch
      }
    } catch (error) {
      console.error("❌ Error parsing row:", error.message);
      errorCount++;
    }
  }

  // Process remaining rows
  if (rows.length > 0) {
    console.log(`\n📦 Processing final batch of ${rows.length} titles...`);
    const { data, error } = await supabase
      .from("titles")
      .upsert(rows, { onConflict: "id" });

    if (error) {
      console.error("❌ Final batch insert error:", error.message);
      errorCount += rows.length;
    } else {
      processedCount += rows.length;
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Processed: ${processedCount} titles`);
  console.log(`   Errors: ${errorCount}`);

  // Verify embeddings
  console.log(`\n🔍 Verifying imported data...`);
  const { data: verification, error: verifyError } = await supabase
    .from("titles")
    .select("id, title, content_embedding, vibe_embedding, metadata_embedding")
    .limit(5);

  if (verifyError) {
    console.error("❌ Verification error:", verifyError.message);
  } else {
    console.log(`\n📊 Sample of imported data:`);
    verification.forEach((row) => {
      console.log(`   ${row.title}:`);
      console.log(
        `     - content_embedding: ${row.content_embedding ? "Present" : "NULL"}`,
      );
      console.log(
        `     - vibe_embedding: ${row.vibe_embedding ? "Present" : "NULL"}`,
      );
      console.log(
        `     - metadata_embedding: ${row.metadata_embedding ? "Present" : "NULL"}`,
      );
    });
  }
}

// Run import
importCSV().catch(console.error);
