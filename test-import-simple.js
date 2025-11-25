import "dotenv/config.js";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { parse } from "csv-parse/sync";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const CSV_FILE = "/Users/idrisskone/Documents/GitHub/DBSetup/test-import.csv";

async function testImport() {
  console.log(`\n📂 Reading test CSV: ${CSV_FILE}`);

  // Read entire file at once for small test
  const fileContent = fs.readFileSync(CSV_FILE, 'utf-8');

  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`Found ${records.length} records (excluding header)`);

  for (const record of records) {
    console.log(`\n🔍 Processing: ${record.title}`);
    console.log(`   ID: ${record.id}`);

    // Check embedding format
    if (record.content_embedding) {
      const embStr = record.content_embedding.substring(0, 50);
      console.log(`   content_embedding starts with: ${embStr}...`);

      try {
        const emb = JSON.parse(record.content_embedding);
        console.log(`   ✅ Parsed content_embedding: ${emb.length} dimensions`);
      } catch (e) {
        console.log(`   ❌ Failed to parse content_embedding: ${e.message}`);
      }
    }

    // Try inserting just basic fields first (no embeddings)
    const basicData = {
      id: parseInt(record.id),
      title: record.title,
      kind: record.kind,
      overview: record.overview,
    };

    console.log(`   Attempting basic insert...`);
    const { data, error } = await supabase
      .from('titles')
      .upsert(basicData, { onConflict: 'id' })
      .select();

    if (error) {
      console.log(`   ❌ Error: ${error.message}`);
    } else {
      console.log(`   ✅ Basic insert successful`);
    }
  }
}

testImport().catch(console.error);
