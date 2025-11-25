import "dotenv/config.js";
import pg from "pg";
import fs from "fs";

const { Client } = pg;

// Parse connection string
const connectionString = process.env.DATABASE_URL;

const CSV_FILE = "/Users/idrisskone/Documents/GitHub/DBSetup/titles_rows copy.csv";

async function importWithPSQL() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL");

    // Use PostgreSQL's COPY command for efficient bulk import
    console.log(`\n📂 Importing from: ${CSV_FILE}`);
    console.log("⚠️  Note: This will replace existing data with same IDs\n");

    const copyQuery = `
      COPY titles (
        id, kind, imdb_id, title, original_title, overview, release_date,
        runtime_minutes, poster_path, backdrop_path, vote_average, vote_count,
        popularity, genres, languages, providers, payload, content_embedding,
        created_at, updated_at, profile_string, vibes, themes, pacing, tone,
        wiki_source_url, slots, cast, director, writers, creators, collection_id,
        collection_name, certification, production_countries, keywords, tagline,
        vibe_embedding, metadata_embedding
      )
      FROM STDIN WITH (
        FORMAT csv,
        HEADER true,
        NULL '\\N',
        DELIMITER ','
      )
    `;

    const fileStream = fs.createReadStream(CSV_FILE);
    const copyStream = client.query(require('pg-copy-streams').from(copyQuery));

    fileStream.pipe(copyStream);

    await new Promise((resolve, reject) => {
      copyStream.on('finish', resolve);
      copyStream.on('error', reject);
      fileStream.on('error', reject);
    });

    console.log("✅ Import complete!");

    // Verify
    const result = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(content_embedding) as has_content,
        COUNT(vibe_embedding) as has_vibe,
        COUNT(metadata_embedding) as has_metadata
      FROM titles
    `);

    console.log("\n📊 Verification:");
    console.log(`   Total titles: ${result.rows[0].total}`);
    console.log(`   With content_embedding: ${result.rows[0].has_content}`);
    console.log(`   With vibe_embedding: ${result.rows[0].has_vibe}`);
    console.log(`   With metadata_embedding: ${result.rows[0].has_metadata}`);

  } catch (error) {
    console.error("❌ Import failed:", error.message);
    throw error;
  } finally {
    await client.end();
  }
}

importWithPSQL().catch(console.error);
