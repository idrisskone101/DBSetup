// Apply all database migrations using Supabase
// Replaces: psql commands for migrations
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import fs from "fs";

const MIGRATIONS = [
  {
    name: "Reduce embedding dimensions (1536 → 768)",
    file: "migrations/2025-10-27-reduce-embedding-dimensions.sql",
  },
  {
    name: "Add full-text search",
    file: "migrations/2025-10-27-add-fulltext-search.sql",
  },
  {
    name: "Add popularity boosting",
    file: "migrations/2025-10-27-add-popularity-boost.sql",
  },
  {
    name: "Create hybrid search function",
    file: "create-hybrid-search-function.sql",
  },
];

async function runMigration(migration) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📝 Running: ${migration.name}`);
  console.log("=".repeat(80));

  try {
    // Read SQL file
    const sql = fs.readFileSync(migration.file, "utf8");

    console.log(`📄 File: ${migration.file}`);
    console.log(`📊 SQL length: ${sql.length} characters\n`);

    // Execute SQL
    console.log("⚙️  Executing migration...");
    const { data, error } = await supabase.rpc("exec_sql", { sql_query: sql });

    if (error) {
      // Try direct execution via execute_sql if exec_sql doesn't exist
      console.log("⚠️  Trying alternative execution method...");

      // Split into individual statements and execute one by one
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));

      for (const statement of statements) {
        if (statement.toLowerCase().includes("begin") ||
            statement.toLowerCase().includes("commit")) {
          continue; // Skip transaction control in individual statements
        }

        const { error: execError } = await supabase.rpc("execute_sql", {
          query: statement + ";"
        });

        if (execError) {
          throw execError;
        }
      }

      console.log("✅ Migration completed successfully!\n");
    } else {
      console.log("✅ Migration completed successfully!\n");
    }

    return { success: true };
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    console.error("   File:", migration.file);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║              APPLY DATABASE MIGRATIONS                       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("⚠️  IMPORTANT: Make sure you have a backup before proceeding!");
  console.log("   Run: node backup-database.js\n");

  const results = [];

  for (const migration of MIGRATIONS) {
    const result = await runMigration(migration);
    results.push({ ...migration, ...result });

    // Small delay between migrations
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 MIGRATION SUMMARY");
  console.log("=".repeat(80));

  results.forEach((result, i) => {
    const status = result.success ? "✅" : "❌";
    console.log(`${i + 1}. ${status} ${result.name}`);
    if (!result.success) {
      console.log(`   Error: ${result.error}`);
    }
  });

  const successCount = results.filter((r) => r.success).length;
  console.log(`\nTotal: ${successCount}/${results.length} migrations successful`);

  if (successCount === results.length) {
    console.log("\n✅ All migrations applied successfully!");
    console.log("\nNext step: Run embedding regeneration");
    console.log("   npm run backfill:768\n");
  } else {
    console.log("\n⚠️  Some migrations failed. Please check errors above.\n");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
