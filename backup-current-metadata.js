#!/usr/bin/env node
// Backup current metadata before re-enrichment
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const match = databaseUrl.match(/db\.([^.]+)\.supabase\.co/);
if (!match) {
  throw new Error("Could not parse Supabase project ref from DATABASE_URL");
}
const projectRef = match[1];
const supabaseUrl = `https://${projectRef}.supabase.co`;

const supabase = createClient(
  supabaseUrl,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function backup() {
  console.log("📦 Backing up current metadata...\n");

  const { data, error } = await supabase
    .from("titles")
    .select("id, title, vibes, themes, tone, pacing, profile_string, wiki_source_url");

  if (error) {
    throw new Error(`Backup failed: ${error.message}`);
  }

  const timestamp = Date.now();
  const filename = `backup_metadata_${timestamp}.json`;

  fs.writeFileSync(filename, JSON.stringify(data, null, 2));

  console.log(`✅ Backup saved to: ${filename}`);
  console.log(`   Records backed up: ${data.length}`);
  console.log(`   Timestamp: ${new Date(timestamp).toISOString()}`);
  console.log(`\n💾 File size: ${(fs.statSync(filename).size / 1024 / 1024).toFixed(2)} MB`);
  console.log("\n⚠️  Keep this backup safe! You'll need it if you want to rollback.");
}

backup().catch(console.error);
