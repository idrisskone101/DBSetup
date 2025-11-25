// Apply all database migrations using direct PostgreSQL connection
// This script uses pg library instead of Supabase RPC
import "dotenv/config.js";
import pkg from "pg";
const { Client } = pkg;
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

async function runMigration(client, migration) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📝 Running: ${migration.name}`);
  console.log("=".repeat(80));

  try {
    // Read SQL file
    const sql = fs.readFileSync(migration.file, "utf8");

    console.log(`📄 File: ${migration.file}`);
    console.log(`📊 SQL length: ${sql.length} characters\n`);

    // Execute SQL directly
    console.log("⚙️  Executing migration...");
    await client.query(sql);

    console.log("✅ Migration completed successfully!\n");
    return { success: true };
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    console.error("   File:", migration.file);
    if (error.detail) {
      console.error("   Detail:", error.detail);
    }
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║              APPLY DATABASE MIGRATIONS                       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("⚠️  IMPORTANT: Make sure you have a backup before proceeding!");
  console.log("   Run: node backup-database.js\n");

  // Create PostgreSQL client
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log("🔌 Connecting to database...");
    await client.connect();
    console.log("✅ Connected!\n");

    const results = [];

    for (const migration of MIGRATIONS) {
      const result = await runMigration(client, migration);
      results.push({ ...migration, ...result });

      // Small delay between migrations
      await new Promise((resolve) => setTimeout(resolve, 1000));
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
      console.log("   node regenerate-embeddings-768.js\n");
    } else {
      console.log("\n⚠️  Some migrations failed. Please check errors above.\n");
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Connection error:", error.message);
    console.error("\n💡 Make sure your DATABASE_URL is correctly set in .env");
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
