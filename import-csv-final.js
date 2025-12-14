import "dotenv/config.js";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { parse } from "csv-parse";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const CSV_FILE = "/Users/idrisskone/Documents/GitHub/DBSetup/titles_rows copy.csv";
const BATCH_SIZE = 10; // Small batches due to large embedding data

/**
 * Parse array string from CSV (handles PostgreSQL array format)
 */
function parseArray(str) {
  if (!str || str === "\\N" || str === "") return null;

  // Handle PostgreSQL array format: {"item1","item2"}
  if (str.startsWith("{") && str.endsWith("}")) {
    const content = str.slice(1, -1);
    if (!content) return [];

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

    return items.map(item => item.replace(/^"|"$/g, ""));
  }

  return null;
}

/**
 * Parse JSON string from CSV
 */
function parseJSON(str) {
  if (!str || str === "\\N" || str === "") return null;
  try {
    return JSON.parse(str);
  } catch (error) {
    return null;
  }
}

/**
 * Parse embedding from CSV
 */
function parseEmbedding(str) {
  if (!str || str === "\\N" || str === "") return null;
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(v => parseFloat(v));
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Sanitize date fields - converts empty strings to null for PostgreSQL DATE type
 */
function sanitizeDate(value) {
  if (!value || value === "\\N" || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  return value;
}

/**
 * Parse a single row from CSV
 */
function parseRow(row) {
  const data = {
    id: row.id ? parseInt(row.id) : null,
    kind: row.kind || null,
    imdb_id: row.imdb_id || null,
    title: row.title || null,
    original_title: row.original_title || null,
    overview: row.overview || null,
    release_date: sanitizeDate(row.release_date),
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
  };

  // Parse embeddings
  const contentEmb = parseEmbedding(row.content_embedding);
  const vibeEmb = parseEmbedding(row.vibe_embedding);
  const metadataEmb = parseEmbedding(row.metadata_embedding);

  if (contentEmb) data.content_embedding = contentEmb;
  if (vibeEmb) data.vibe_embedding = vibeEmb;
  if (metadataEmb) data.metadata_embedding = metadataEmb;

  return data;
}

/**
 * Import CSV data in batches
 */
async function importCSV() {
  console.log(`\n📂 Reading CSV file: ${CSV_FILE}\n`);

  const rows = [];
  let processedCount = 0;
  let errorCount = 0;
  let embeddingCount = 0;

  const parser = fs
    .createReadStream(CSV_FILE)
    .pipe(parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }));

  for await (const row of parser) {
    try {
      const parsed = parseRow(row);
      rows.push(parsed);

      if (parsed.content_embedding) embeddingCount++;

      // Process in batches
      if (rows.length >= BATCH_SIZE) {
        const { error } = await supabase
          .from("titles")
          .upsert(rows, { onConflict: "id" });

        if (error) {
          console.error(`❌ Batch error: ${error.message}`);
          errorCount += rows.length;
        } else {
          processedCount += rows.length;
          console.log(`✅ Imported ${processedCount} titles (${embeddingCount} with embeddings)`);
        }

        rows.length = 0;
      }
    } catch (error) {
      console.error(`❌ Parse error: ${error.message}`);
      errorCount++;
    }
  }

  // Final batch
  if (rows.length > 0) {
    const { error } = await supabase
      .from("titles")
      .upsert(rows, { onConflict: "id" });

    if (error) {
      console.error(`❌ Final batch error: ${error.message}`);
      errorCount += rows.length;
    } else {
      processedCount += rows.length;
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Successfully imported: ${processedCount} titles`);
  console.log(`   Errors: ${errorCount}`);

  // Verify
  const { data: verification } = await supabase
    .from("titles")
    .select("id, title, content_embedding, vibe_embedding, metadata_embedding")
    .not("content_embedding", "is", null)
    .limit(3);

  if (verification) {
    console.log(`\n📊 Sample verification (titles with embeddings):`);
    verification.forEach(row => {
      console.log(`   - ${row.title}: embeddings present ✅`);
    });
  }
}

importCSV().catch(console.error);
