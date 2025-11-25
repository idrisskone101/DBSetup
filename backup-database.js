// Backup database by exporting current state
// Replaces: pg_dump command
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import fs from "fs";

async function backupDatabase() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                   DATABASE BACKUP                            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `backup-${timestamp}.json`;

  console.log(`📁 Backup file: ${backupFile}\n`);

  try {
    // Fetch all titles data
    console.log("🔍 Fetching all titles...");
    const { data: titles, error } = await supabase
      .from("titles")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch titles: ${error.message}`);
    }

    console.log(`✅ Retrieved ${titles.length} titles\n`);

    // Create backup object
    const backup = {
      timestamp: new Date().toISOString(),
      project_id: process.env.SUPABASE_PROJECT_ID || "eblujlkrvssoypzqvlku",
      total_titles: titles.length,
      schema_version: "2.0.0",
      titles: titles,
      metadata: {
        embedding_dimensions: titles[0]?.content_embedding ?
          (titles[0].content_embedding.length || "unknown") : "none",
        has_search_vector: titles.filter(t => t.search_vector).length,
      }
    };

    // Write to file
    console.log("💾 Writing backup to file...");
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

    const fileSizeMB = (fs.statSync(backupFile).size / 1024 / 1024).toFixed(2);
    console.log(`✅ Backup complete: ${fileSizeMB} MB\n`);

    // Summary
    console.log("=".repeat(80));
    console.log("📊 BACKUP SUMMARY");
    console.log("=".repeat(80));
    console.log(`File: ${backupFile}`);
    console.log(`Size: ${fileSizeMB} MB`);
    console.log(`Titles: ${titles.length}`);
    console.log(`Embedding dims: ${backup.metadata.embedding_dimensions}`);
    console.log(`Has search_vector: ${backup.metadata.has_search_vector} titles`);
    console.log("=".repeat(80));

    console.log("\n✅ Backup successful!");
    console.log("\nTo restore from this backup later:");
    console.log(`   node restore-database.js ${backupFile}\n`);

    return backupFile;
  } catch (error) {
    console.error("\n❌ Backup failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

backupDatabase();
