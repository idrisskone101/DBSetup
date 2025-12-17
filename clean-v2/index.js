#!/usr/bin/env node

/**
 * Clean-v2 Pipeline CLI
 * Main entry point for running pipelines
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  refresh: {
    description: "Re-fetch TMDB metadata for existing titles",
    script: "pipelines/refresh-pipeline.js",
    options: [
      { flag: "--limit <n>", desc: "Maximum titles to process (default: all)" },
      { flag: "--offset <n>", desc: "Skip first n titles (default: 0)" },
      { flag: "--movies-only", desc: "Only process movies" },
      { flag: "--tv-only", desc: "Only process TV shows" },
      { flag: "--resume", desc: "Resume from checkpoint" },
    ],
  },
  enrich: {
    description: "Re-enrich titles with Wikipedia + LLM + embeddings",
    script: "pipelines/enrichment-pipeline.js",
    options: [
      { flag: "--limit <n>", desc: "Maximum titles to process (default: all)" },
      { flag: "--offset <n>", desc: "Skip first n titles (default: 0)" },
      { flag: "--unenriched-only", desc: "Only process titles not yet enriched" },
      { flag: "--movies-only", desc: "Only process movies" },
      { flag: "--tv-only", desc: "Only process TV shows" },
      { flag: "--resume", desc: "Resume from checkpoint" },
    ],
  },
  "repair-tmdb": {
    description: "Repair titles with missing TMDB metadata",
    script: "pipelines/repair-tmdb-pipeline.js",
    options: [
      { flag: "--limit <n>", desc: "Maximum titles to process (default: 2000)" },
      { flag: "--dry-run", desc: "Preview only, no changes" },
      { flag: "--movies-only", desc: "Only process movies" },
      { flag: "--tv-only", desc: "Only process TV shows" },
      { flag: "--field <name>", desc: "Target specific field (overview, director, etc.)" },
      { flag: "--retry-errors", desc: "Re-attempt previously failed API calls" },
      { flag: "--resume", desc: "Resume from checkpoint" },
    ],
  },
  "repair-enrichment": {
    description: "Repair enriched titles with missing fields",
    script: "pipelines/repair-enrichment-pipeline.js",
    options: [
      { flag: "--limit <n>", desc: "Maximum titles to process (default: 1000)" },
      { flag: "--dry-run", desc: "Preview only, no changes" },
      { flag: "--wiki-only", desc: "Only retry Wikipedia search" },
      { flag: "--embeddings-only", desc: "Only regenerate missing embeddings" },
      { flag: "--field <name>", desc: "Target specific field (vibes, themes, etc.)" },
      { flag: "--retry-partial", desc: "Re-attempt partial successes" },
      { flag: "--quick-wins", desc: "Process embeddings-only repairs first" },
      { flag: "--resume", desc: "Resume from checkpoint" },
    ],
  },
  "repair-embeddings": {
    description: "Regenerate embeddings for enriched titles",
    script: "pipelines/repair-embeddings-pipeline.js",
    options: [
      { flag: "--limit <n>", desc: "Maximum titles to process (default: 500)" },
      { flag: "--dry-run", desc: "Preview only, no changes" },
      { flag: "--movies-only", desc: "Only process movies" },
      { flag: "--tv-only", desc: "Only process TV shows" },
      { flag: "--all", desc: "Process all enriched titles (ignore needs_enrichment flag)" },
      { flag: "--resume", desc: "Resume from checkpoint" },
    ],
  },
  "repair-status": {
    description: "Show repair queue status and field breakdown",
    script: "pipelines/repair-status.js",
    options: [],
  },
  repair: {
    description: "[DEPRECATED] Use repair-tmdb or repair-enrichment instead",
    script: "pipelines/repair-pipeline.js",
    options: [
      { flag: "--limit <n>", desc: "Maximum titles to process (default: 1000)" },
      { flag: "--dry-run", desc: "Report issues without fixing" },
      { flag: "--retry-wiki", desc: "Retry Wikipedia for titles without wiki_source_url" },
    ],
  },
};

function printUsage() {
  console.log("\nClean-v2 Pipeline CLI\n");
  console.log("Usage: node index.js <command> [options]\n");
  console.log("Commands:");

  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`\n  ${name}`);
    console.log(`    ${cmd.description}`);
    console.log("    Options:");
    for (const opt of cmd.options) {
      console.log(`      ${opt.flag.padEnd(20)} ${opt.desc}`);
    }
  }

  console.log("\nExamples:");
  console.log("  node index.js refresh --limit 500 --movies-only");
  console.log("  node index.js enrich --limit 10000");
  console.log("  node index.js enrich --unenriched-only --limit 5000");
  console.log("  node index.js repair-tmdb --limit 500");
  console.log("  node index.js repair-enrichment --embeddings-only --limit 200");
  console.log("  node index.js repair-status");
  console.log("");
}

function runCommand(command, args) {
  const cmd = COMMANDS[command];
  if (!cmd) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  const scriptPath = path.join(__dirname, cmd.script);

  console.log(`\nRunning: ${command}`);
  console.log(`Script: ${scriptPath}`);
  console.log(`Args: ${args.join(" ") || "(none)"}\n`);

  const child = spawn("node", [scriptPath, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  child.on("error", (err) => {
    console.error(`Failed to start: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code || 0);
  });
}

// Parse command line
const args = process.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

if (!command || command === "--help" || command === "-h") {
  printUsage();
  process.exit(0);
}

runCommand(command, commandArgs);
