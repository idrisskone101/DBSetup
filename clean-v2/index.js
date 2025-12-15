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
  console.log("  node index.js enrich --offset 10000 --limit 10000");
  console.log("  node index.js enrich --unenriched-only --limit 5000");
  console.log("  node index.js enrich --resume");
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
