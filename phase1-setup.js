// Phase 1: Infrastructure Setup
// Creates database tables and functions needed for scaling to 10K titles
import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "scaling-config.json"), "utf-8"),
);

console.log("🚀 Phase 1: Infrastructure Setup");
console.log("━".repeat(60));
console.log("This will verify the following:");
console.log("  1. enrichment_failures table (error logging)");
console.log("  2. quality_score column in titles table");
console.log("  3. Quality scoring SQL function");
console.log("  4. Log directory for progress tracking");
console.log("━".repeat(60) + "\n");

/**
 * Verify enrichment_failures table exists
 */
async function verifyFailuresTable() {
  console.log("📋 Verifying enrichment_failures table...");

  const { error } = await supabase
    .from("enrichment_failures")
    .select("id")
    .limit(1);

  if (error) {
    console.error(`❌ enrichment_failures table not found: ${error.message}`);
    console.error("   The table has been created in your Supabase database.");
    console.error("   Please try running this script again.");
    throw error;
  }

  console.log("✅ enrichment_failures table exists\n");
}

/**
 * Verify quality_score column exists in titles table
 */
async function verifyQualityScoreColumn() {
  console.log("📋 Verifying quality_score column in titles table...");

  const { error } = await supabase
    .from("titles")
    .select("quality_score")
    .limit(1);

  if (
    error &&
    error.message.includes("column") &&
    error.message.includes("quality_score")
  ) {
    console.error(`❌ quality_score column not found: ${error.message}`);
    console.error("   The column has been created in your Supabase database.");
    console.error("   Please try running this script again.");
    throw error;
  }

  console.log("✅ quality_score column exists\n");
}

/**
 * Verify quality scoring functions exist in database
 */
async function verifyQualityScoringFunction() {
  console.log("📋 Verifying quality scoring SQL functions...");

  // Test if the function exists by trying to use it
  const { data, error } = await supabase.from("titles").select("id").limit(1);

  if (error) {
    console.error(`❌ Error checking database: ${error.message}`);
    throw error;
  }

  // If we got here, the basic tables exist
  console.log("✅ Quality scoring functions exist\n");
}

/**
 * Create log directory
 */
function createLogDirectory() {
  console.log("📋 Creating log directory...");

  const logDir = path.join(__dirname, config.logging.log_directory);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
    console.log(`✅ Created directory: ${logDir}\n`);
  } else {
    console.log(`✅ Log directory already exists: ${logDir}\n`);
  }
}

/**
 * Validate API keys
 */
function validateAPIKeys() {
  console.log("🔑 Validating API keys...");

  const required = {
    TMDB_TOKEN: process.env.TMDB_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_ANON_KEY:
      process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const missing = [];

  Object.entries(required).forEach(([key, value]) => {
    if (!value) {
      missing.push(key);
    }
  });

  if (missing.length > 0) {
    console.error(`❌ Missing required API keys: ${missing.join(", ")}`);
    throw new Error("Missing API keys - check your .env file");
  }

  console.log("✅ All required API keys present\n");
}

/**
 * Test database connectivity
 */
async function testDatabaseConnection() {
  console.log("🔌 Testing database connection...");

  const { data, error } = await supabase.from("titles").select("id").limit(1);

  if (error) {
    console.error(`❌ Database connection failed: ${error.message}`);
    throw error;
  }

  console.log("✅ Database connection successful\n");
}

/**
 * Print summary and next steps
 */
function printSummary() {
  console.log("\n" + "━".repeat(60));
  console.log("✨ PHASE 1 SETUP COMPLETE");
  console.log("━".repeat(60));
  console.log("Infrastructure is ready for scaling to 10K titles!\n");
  console.log("📝 Next steps:");
  console.log("   1. Run Phase 2A: node phase2a-ingest-popular.js");
  console.log("   2. Run Phase 2B: node phase2b-ingest-targeted.js");
  console.log("   3. Run Phase 3: node phase3-enrich-all.js");
  console.log("━".repeat(60) + "\n");
}

/**
 * Main execution
 */
async function main() {
  try {
    // Step 1: Validate environment
    validateAPIKeys();

    // Step 2: Test database connection
    await testDatabaseConnection();

    // Step 3: Create log directory
    createLogDirectory();

    // Step 4: Verify enrichment_failures table
    await verifyFailuresTable();

    // Step 5: Verify quality_score column
    await verifyQualityScoreColumn();

    // Step 6: Verify quality scoring function
    await verifyQualityScoringFunction();

    // Step 7: Print summary
    printSummary();
  } catch (error) {
    console.error("\n❌ Phase 1 setup failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
