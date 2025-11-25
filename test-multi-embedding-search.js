import "dotenv/config.js";
import { supabase } from "./supabase-upsert.js";
import OpenAI from "openai";
import { createInterface } from "readline";
import { expandQuerySafe, expandQueryCached } from "./query-expansion.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_WEIGHTS = {
  content: 0.4,
  vibe: 0.35,
  metadata: 0.25,
};

const DEFAULT_OPTIONS = {
  matchThreshold: 0.3,
  matchCount: 10,
  useDynamicWeights: true, // Use LLM to calculate weights based on query
  llmModel: "gpt-4o-mini", // Model for query analysis
};

// ============================================================================
// QUERY ANALYSIS & DYNAMIC WEIGHTS
// ============================================================================

/**
 * Analyze query intent using LLM to determine optimal embedding weights
 * @param {string} query - User's search query
 * @param {string} model - OpenAI model to use for analysis
 * @returns {Promise<Object>} - { content, vibe, metadata, reasoning }
 */
async function analyzeQueryIntent(query, model = "gpt-4o-mini") {
  const systemPrompt = `You are a query analyzer for a movie/TV semantic search system with three embedding types:

1. CONTENT embedding: Captures story/plot elements
   - Narrative themes (revenge, redemption, coming-of-age)
   - Story structure (time travel, heist, mystery)
   - Character arcs and relationships
   - Plot devices and story beats

2. VIBE embedding: Captures emotional/atmospheric qualities
   - Mood and feeling (cozy, dark, whimsical, gritty)
   - Tone (earnest, melancholic, campy, noir)
   - Pacing (slow-burn, kinetic, contemplative)
   - Aesthetic and visual style

3. METADATA embedding: Captures factual/categorical information
   - Genres (superhero, comedy, thriller, sci-fi)
   - Directors and creators (Nolan, Tarantino)
   - Actors and cast
   - Years, ratings, franchises
   - Production details

Your task: Analyze the search query and return optimal weights (0-1, summing to 1.0) for each embedding type.

WEIGHTING RULES:
- Genre/franchise/director/actor mentions → prioritize METADATA (0.5-0.7)
- Plot/story/theme descriptions → prioritize CONTENT (0.5-0.7)
- Mood/feeling/atmosphere adjectives → prioritize VIBE (0.5-0.7)
- Hybrid queries → distribute weights proportionally based on emphasis
- Ambiguous queries → default balanced (content: 0.4, vibe: 0.35, metadata: 0.25)

EXAMPLES:
- "funny superhero movies" → metadata: 0.55, vibe: 0.25, content: 0.20 (genre takes priority)
- "cozy romantic comedies" → vibe: 0.60, metadata: 0.25, content: 0.15 (mood-focused)
- "Christopher Nolan films" → metadata: 0.70, content: 0.20, vibe: 0.10 (director-focused)
- "time travel paradox story" → content: 0.60, metadata: 0.25, vibe: 0.15 (plot-focused)
- "dark revenge thriller" → vibe: 0.45, content: 0.35, metadata: 0.20 (balanced mood+story)

Return ONLY valid JSON:
{
  "content": 0.XX,
  "vibe": 0.XX,
  "metadata": 0.XX,
  "reasoning": "Brief explanation of weight distribution"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze this query: "${query}"` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 150,
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Validate weights
    if (
      typeof result.content !== "number" ||
      typeof result.vibe !== "number" ||
      typeof result.metadata !== "number"
    ) {
      throw new Error("Invalid weight types in LLM response");
    }

    const sum = result.content + result.vibe + result.metadata;
    if (Math.abs(sum - 1.0) > 0.01) {
      // Normalize if slightly off
      result.content /= sum;
      result.vibe /= sum;
      result.metadata /= sum;
    }

    return result;
  } catch (error) {
    console.warn(
      "⚠️  Query analysis failed, using default weights:",
      error.message,
    );
    return {
      ...DEFAULT_WEIGHTS,
      reasoning: "Fallback to default weights due to analysis error",
    };
  }
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

/**
 * Generate formatted text for each embedding type from a search query
 * Now supports query expansion for improved recall
 * @param {string} query - User's search query (can be original or expanded)
 * @param {Object} expandedQuery - Optional pre-expanded query object
 * @returns {Object} - { vibe, content, metadata } text inputs
 */
function generateQueryTexts(query, expandedQuery = null) {
  if (expandedQuery) {
    // Use expanded versions if provided
    return {
      vibe: `Vibes: ${expandedQuery.vibe}. Tone: ${expandedQuery.vibe}`,
      content: `Story: ${expandedQuery.content}. Overview: ${expandedQuery.content}. Themes: ${expandedQuery.content}`,
      metadata: `Genres: ${expandedQuery.metadata}. Type: ${expandedQuery.metadata}. Keywords: ${expandedQuery.metadata}`,
    };
  }

  // Fallback to original format (no expansion)
  return {
    // Vibe: treat query as atmospheric/emotional descriptor
    vibe: `Vibes: ${query}. Tone: ${query}. Tagline: ${query}`,

    // Content: treat query as story/plot description
    content: `Story: ${query}. Overview: ${query}. Themes: ${query}`,

    // Metadata: treat query as genre/category descriptor
    metadata: `Genres: ${query}. Type: ${query}. Keywords: ${query}`,
  };
}

/**
 * Generate all 3 embeddings for a search query
 * @param {string} query - User's search query
 * @param {Object} expandedQuery - Optional pre-expanded query object
 * @returns {Promise<Object>} - { vibe, content, metadata } embeddings
 */
async function generateQueryEmbeddings(query, expandedQuery = null) {
  const texts = generateQueryTexts(query, expandedQuery);

  console.log("🤖 Generating query embeddings (3 types)...");

  try {
    // Generate all 3 embeddings in a single API call for efficiency
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [texts.content, texts.vibe, texts.metadata],
      dimensions: 768, // Matryoshka: 768 dims for better performance
      encoding_format: "float",
    });

    const embeddings = {
      content: response.data[0].embedding,
      vibe: response.data[1].embedding,
      metadata: response.data[2].embedding,
    };

    console.log("✅ Query embeddings generated\n");
    return embeddings;
  } catch (error) {
    console.error("❌ Error generating query embeddings:", error.message);
    throw error;
  }
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

/**
 * Perform weighted multi-embedding search
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Search results with scores
 */
async function searchWithBlend(query, options = {}) {
  const {
    weights: manualWeights = null,
    matchThreshold = DEFAULT_OPTIONS.matchThreshold,
    matchCount = DEFAULT_OPTIONS.matchCount,
    useDynamicWeights = DEFAULT_OPTIONS.useDynamicWeights,
    llmModel = DEFAULT_OPTIONS.llmModel,
    verbose = true,
    useExpansion = true, // NEW: Enable query expansion by default
    useCache = true, // NEW: Use caching for expansion
  } = options;

  if (verbose) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`🔍 Query: "${query}"`);
    console.log("=".repeat(80) + "\n");
  }

  // NEW: Query expansion (if enabled)
  let expandedQuery = null;
  if (useExpansion) {
    if (verbose) {
      console.log("🔄 Expanding query with LLM...");
    }

    try {
      expandedQuery = useCache
        ? await expandQueryCached(query, { verbose })
        : await expandQuerySafe(query, { verbose });

      if (verbose && expandedQuery.vibe !== query) {
        console.log("✅ Query expanded successfully");
        console.log(`   Vibe: "${expandedQuery.vibe.substring(0, 60)}..."`);
        console.log(
          `   Content: "${expandedQuery.content.substring(0, 60)}..."`,
        );
        console.log(
          `   Metadata: "${expandedQuery.metadata.substring(0, 60)}..."\n`,
        );
      }
    } catch (error) {
      if (verbose) {
        console.warn(`⚠️  Expansion failed, using original query\n`);
      }
      expandedQuery = null;
    }
  }

  // Determine weights: manual override > dynamic > default
  let weights;
  let weightReasoning = null;

  if (manualWeights) {
    // Use manually specified weights
    weights = manualWeights;
    weightReasoning = "Manually specified weights";
    if (verbose) {
      console.log("⚙️  Using manual weights (override)\n");
    }
  } else if (useDynamicWeights) {
    // Use LLM to analyze query and calculate weights
    if (verbose) {
      console.log("🧠 Analyzing query intent with LLM...");
    }
    const analysis = await analyzeQueryIntent(query, llmModel);
    weights = {
      content: analysis.content,
      vibe: analysis.vibe,
      metadata: analysis.metadata,
    };
    weightReasoning = analysis.reasoning;
    if (verbose) {
      console.log(`✅ ${analysis.reasoning}\n`);
    }
  } else {
    // Use static default weights
    weights = DEFAULT_WEIGHTS;
    weightReasoning = "Static default weights";
    if (verbose) {
      console.log("⚙️  Using static default weights\n");
    }
  }

  // Generate embeddings for query (with optional expansion)
  const embeddings = await generateQueryEmbeddings(query, expandedQuery);

  // Call SQL function
  if (verbose) {
    console.log("🎬 Searching database with weighted blend...");
    console.log(
      `   Weights: content=${(weights.content * 100).toFixed(0)}%, vibe=${(weights.vibe * 100).toFixed(0)}%, metadata=${(weights.metadata * 100).toFixed(0)}%`,
    );
    console.log(
      `   Threshold: ${matchThreshold} | Max results: ${matchCount}\n`,
    );
  }

  const { data, error } = await supabase.rpc("match_titles_multi", {
    query_content_embedding: embeddings.content,
    query_vibe_embedding: embeddings.vibe,
    query_metadata_embedding: embeddings.metadata,
    weight_content: weights.content,
    weight_vibe: weights.vibe,
    weight_metadata: weights.metadata,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error) {
    console.error("❌ Search error:", error.message);
    throw error;
  }

  // Attach weight metadata to results
  const results = data || [];
  if (results.length > 0) {
    results._metadata = {
      weights,
      weightReasoning,
      query,
    };
  }

  return results;
}

// ============================================================================
// DISPLAY FUNCTIONS
// ============================================================================

/**
 * Create a visual progress bar
 * @param {number} value - Value between 0 and 1
 * @param {number} width - Bar width in characters
 * @returns {string} - Progress bar string
 */
function createProgressBar(value, width = 40) {
  const filled = Math.round(value * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

/**
 * Format a score with visual indicator
 * @param {number} score - Score between 0 and 1
 * @param {boolean} isStrongest - Whether this is the strongest signal
 * @returns {string} - Formatted score string
 */
function formatScore(score, isStrongest = false) {
  const percentage = (score * 100).toFixed(1);
  const marker = isStrongest ? " ★" : "  ";
  return `${percentage.padStart(5)}%${marker}`;
}

/**
 * Display search results in a formatted table
 * @param {Array} results - Search results
 * @param {Object} options - Display options
 */
function displayResults(results, options = {}) {
  const {
    showDetails = true,
    showScoreBreakdown = true,
    maxResults = null,
    showWeightReasoning = false,
  } = options;

  if (!results || results.length === 0) {
    console.log("ℹ️  No results found\n");
    return;
  }

  const displayCount = maxResults
    ? Math.min(maxResults, results.length)
    : results.length;

  console.log("━".repeat(80));
  console.log(
    `📊 Results (showing top ${displayCount} of ${results.length} matches)`,
  );

  // Show weight reasoning if available
  if (showWeightReasoning && results._metadata?.weightReasoning) {
    console.log(`💭 ${results._metadata.weightReasoning}`);
  }

  console.log("━".repeat(80) + "\n");

  for (let i = 0; i < displayCount; i++) {
    const result = results[i];
    const rank = i + 1;

    // Title line
    const year = result.release_date
      ? new Date(result.release_date).getFullYear()
      : "N/A";
    console.log(`${rank}. ⭐ ${result.title} (${year}) [${result.kind}]`);

    // Combined score with progress bar
    const scoreBar = createProgressBar(result.combined_score);
    console.log(
      `   Score: ${result.combined_score.toFixed(3)} ${scoreBar} ${(result.combined_score * 100).toFixed(1)}%`,
    );

    // Score breakdown
    if (showScoreBreakdown) {
      console.log(`   Breakdown:`);
      console.log(
        `     • content:  ${formatScore(result.content_score, result.strongest_signal === "content")}`,
      );
      console.log(
        `     • vibe:     ${formatScore(result.vibe_score, result.strongest_signal === "vibe")}`,
      );
      console.log(
        `     • metadata: ${formatScore(result.metadata_score, result.strongest_signal === "metadata")}`,
      );
    }

    // Details
    if (showDetails) {
      if (result.genres && result.genres.length > 0) {
        console.log(`   Genres: ${result.genres.join(", ")}`);
      }

      if (result.vibes && result.vibes.length > 0) {
        console.log(`   Vibes: ${result.vibes.join(", ")}`);
      }

      if (result.themes && result.themes.length > 0) {
        console.log(`   Themes: ${result.themes.join(", ")}`);
      }

      if (result.director) {
        console.log(`   Director: ${result.director}`);
      }

      if (result.certification) {
        console.log(`   Rating: ${result.certification}`);
      }

      if (result.vote_average) {
        console.log(`   TMDB Score: ${result.vote_average}/10`);
      }

      if (result.overview) {
        const shortOverview =
          result.overview.length > 150
            ? result.overview.substring(0, 150) + "..."
            : result.overview;
        console.log(`   Overview: ${shortOverview}`);
      }
    }

    console.log(); // Blank line between results
  }

  console.log("━".repeat(80));
  console.log(
    `[Legend: ★ = strongest signal | Bar = combined score visualization]`,
  );
  console.log("━".repeat(80) + "\n");
}

/**
 * Display configuration summary
 * @param {Object} weights - Weight configuration
 * @param {Object} options - Search options
 */
function displayConfig(weights, options) {
  console.log("⚙️  Configuration:");
  console.log(
    `   Weights: content=${(weights.content * 100).toFixed(0)}%, vibe=${(weights.vibe * 100).toFixed(0)}%, metadata=${(weights.metadata * 100).toFixed(0)}%`,
  );
  console.log(`   Threshold: ${options.matchThreshold} minimum similarity`);
  console.log(`   Max results: ${options.matchCount}`);
  console.log();
}

// ============================================================================
// WEIGHT TUNING
// ============================================================================

/**
 * Interactive weight tuning mode
 * @param {string} query - Search query to use for tuning
 */
async function interactiveTuning(query) {
  console.log("\n" + "=".repeat(80));
  console.log("🎛️  INTERACTIVE WEIGHT TUNING MODE");
  console.log("=".repeat(80) + "\n");
  console.log("Adjust weights to see how results change.");
  console.log('Enter new weights (e.g., "0.5 0.3 0.2") or "q" to quit.\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let currentWeights = { ...DEFAULT_WEIGHTS };

  const askWeights = () => {
    return new Promise((resolve) => {
      rl.question(
        `\nCurrent weights: content=${currentWeights.content} vibe=${currentWeights.vibe} metadata=${currentWeights.metadata}\nEnter new weights (content vibe metadata) or "q" to quit: `,
        (answer) => {
          resolve(answer.trim());
        },
      );
    });
  };

  while (true) {
    // Show results with current weights
    console.log("\n" + "-".repeat(80));
    const results = await searchWithBlend(query, {
      weights: currentWeights,
      matchCount: 5,
      verbose: false,
    });

    displayResults(results, { showDetails: false, maxResults: 5 });
    displayConfig(currentWeights, DEFAULT_OPTIONS);

    // Ask for new weights
    const input = await askWeights();

    if (input.toLowerCase() === "q") {
      console.log("\n✅ Exiting tuning mode. Final weights:");
      console.log(
        `   content=${currentWeights.content}, vibe=${currentWeights.vibe}, metadata=${currentWeights.metadata}\n`,
      );
      rl.close();
      break;
    }

    // Parse weights
    const parts = input.split(/\s+/).map(parseFloat);
    if (
      parts.length === 3 &&
      parts.every((n) => !isNaN(n) && n >= 0 && n <= 1)
    ) {
      const sum = parts.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1.0) < 0.01) {
        currentWeights = {
          content: parts[0],
          vibe: parts[1],
          metadata: parts[2],
        };
        console.log("✅ Weights updated!");
      } else {
        console.log(
          `⚠️  Weights must sum to 1.0 (current sum: ${sum.toFixed(2)})`,
        );
      }
    } else {
      console.log("⚠️  Invalid input. Enter 3 numbers between 0 and 1.");
    }
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

/**
 * Run test queries to validate the search
 */
async function runTestQueries() {
  console.log("\n" + "=".repeat(80));
  console.log("🧪 MULTI-EMBEDDING SEARCH TEST SUITE (Dynamic Weights)");
  console.log("=".repeat(80) + "\n");

  const testCases = [
    {
      query: "funny superhero movies",
      description:
        "Hybrid query: genre (metadata) + mood (vibe) - should prioritize superhero genre",
      expectedPrimary: "metadata",
    },
    {
      query: "cozy romantic comedies",
      description:
        "Vibe-heavy query (should match on emotional/atmospheric profile)",
      expectedPrimary: "vibe",
    },
    {
      query: "christopher nolan films",
      description: "Metadata query (director-focused)",
      expectedPrimary: "metadata",
    },
    {
      query: "time travel paradox story",
      description: "Content query (plot/narrative-focused)",
      expectedPrimary: "content",
    },
    {
      query: "dark gritty revenge thriller",
      description: "Vibe + content query (atmosphere + theme)",
      expectedPrimary: "vibe",
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n📝 Test: ${testCase.description}`);
    console.log(`   Query: "${testCase.query}"`);
    console.log(`   Expected primary weight: ${testCase.expectedPrimary}\n`);

    const results = await searchWithBlend(testCase.query, {
      matchCount: 5,
      verbose: false,
      useDynamicWeights: true,
    });

    displayResults(results, {
      showDetails: true,
      maxResults: 5,
      showWeightReasoning: true,
    });

    // Show actual weights used
    if (results._metadata?.weights) {
      const w = results._metadata.weights;
      console.log("📊 Actual weights used:");
      console.log(
        `   content: ${(w.content * 100).toFixed(0)}%, vibe: ${(w.vibe * 100).toFixed(0)}%, metadata: ${(w.metadata * 100).toFixed(0)}%\n`,
      );
    }

    console.log("\n" + "─".repeat(80) + "\n");

    // Rate limit between queries
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("✅ Test suite complete!\n");
}

/**
 * Compare results with different weight configurations
 * @param {string} query - Search query
 */
async function compareWeights(query) {
  console.log("\n" + "=".repeat(80));
  console.log("⚖️  WEIGHT COMPARISON MODE");
  console.log("=".repeat(80) + "\n");
  console.log(`Query: "${query}"\n`);

  const weightSets = [
    {
      name: "Balanced (default)",
      weights: { content: 0.4, vibe: 0.35, metadata: 0.25 },
    },
    {
      name: "Content-focused",
      weights: { content: 0.6, vibe: 0.25, metadata: 0.15 },
    },
    {
      name: "Vibe-focused",
      weights: { content: 0.25, vibe: 0.6, metadata: 0.15 },
    },
    {
      name: "Metadata-focused",
      weights: { content: 0.25, vibe: 0.15, metadata: 0.6 },
    },
    {
      name: "Equal weights",
      weights: { content: 0.33, vibe: 0.34, metadata: 0.33 },
    },
  ];

  for (const config of weightSets) {
    console.log("\n" + "-".repeat(80));
    console.log(`🎯 ${config.name}`);
    console.log("-".repeat(80) + "\n");

    const results = await searchWithBlend(query, {
      weights: config.weights,
      matchCount: 3,
      verbose: false,
    });

    displayResults(results, { showDetails: false, maxResults: 3 });
    displayConfig(config.weights, DEFAULT_OPTIONS);

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n✅ Comparison complete!\n");
}

/**
 * Export results to JSON file
 * @param {Array} results - Search results
 * @param {string} filename - Output filename
 */
async function exportResults(results, filename = "search-results.json") {
  const fs = await import("fs");
  fs.writeFileSync(filename, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results exported to ${filename}\n`);
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  const flags = {
    test: args.includes("--test"),
    tune: args.includes("--tune"),
    compare: args.includes("--compare"),
    export: args.includes("--export"),
    help: args.includes("--help") || args.includes("-h"),
    staticWeights: args.includes("--static-weights"),
    showWeights: args.includes("--show-weights"),
    noExpansion: args.includes("--no-expansion"), // NEW: Disable query expansion
  };

  // Parse LLM model
  const modelIdx = args.findIndex((a) => a.startsWith("--model="));
  const llmModel =
    modelIdx >= 0 ? args[modelIdx].split("=")[1] : DEFAULT_OPTIONS.llmModel;

  // Parse custom weights (manual override)
  const customWeights = {};
  const contentIdx = args.findIndex((a) => a.startsWith("--content="));
  const vibeIdx = args.findIndex((a) => a.startsWith("--vibe="));
  const metadataIdx = args.findIndex((a) => a.startsWith("--metadata="));

  if (contentIdx >= 0)
    customWeights.content = parseFloat(args[contentIdx].split("=")[1]);
  if (vibeIdx >= 0)
    customWeights.vibe = parseFloat(args[vibeIdx].split("=")[1]);
  if (metadataIdx >= 0)
    customWeights.metadata = parseFloat(args[metadataIdx].split("=")[1]);

  // Get query (first non-flag argument)
  const query = args.find((a) => !a.startsWith("--"));

  // Help
  if (flags.help) {
    console.log(`
Multi-Embedding Search Test Tool

Usage:
  node test-multi-embedding-search.js [query] [options]

Options:
  --test              Run test suite with predefined queries
  --tune              Interactive weight tuning mode
  --compare           Compare different weight configurations
  --export            Export results to JSON file
  --no-expansion      Disable query expansion (use original query only)
  --static-weights    Force static weights (disable dynamic LLM analysis)
  --show-weights      Display weight calculation reasoning in output
  --model=MODEL       Override LLM model for query analysis (default: gpt-4o-mini)
  --content=N         Set content weight manually (0-1, disables dynamic)
  --vibe=N            Set vibe weight manually (0-1, disables dynamic)
  --metadata=N        Set metadata weight manually (0-1, disables dynamic)
  -h, --help          Show this help message

Examples:
  # Use dynamic weights + query expansion (default)
  node test-multi-embedding-search.js "funny superhero movies"

  # Force static weights
  node test-multi-embedding-search.js "cozy rom coms" --static-weights

  # Manual weights (override dynamic)
  node test-multi-embedding-search.js "nolan movies" --content=0.3 --metadata=0.5 --vibe=0.2

  # Use different LLM model
  node test-multi-embedding-search.js "dark thriller" --model=gpt-4o

  # Interactive tuning
  node test-multi-embedding-search.js "superhero movies" --tune

  # Run test suite
  node test-multi-embedding-search.js --test

Dynamic Weights (default): LLM analyzes query to determine optimal weights
Static Weights (--static-weights): content=40%, vibe=35%, metadata=25%
`);
    return;
  }

  // Run test suite
  if (flags.test) {
    await runTestQueries();
    return;
  }

  // Require query for other modes
  if (!query) {
    console.error("❌ Error: Query required (or use --test flag)\n");
    console.log(
      'Usage: node test-multi-embedding-search.js "your query" [options]',
    );
    console.log("       node test-multi-embedding-search.js --help");
    process.exit(1);
  }

  // Interactive tuning
  if (flags.tune) {
    await interactiveTuning(query);
    return;
  }

  // Weight comparison
  if (flags.compare) {
    await compareWeights(query);
    return;
  }

  // Standard search
  const hasManualWeights = Object.keys(customWeights).length > 0;
  const manualWeights = hasManualWeights
    ? { ...DEFAULT_WEIGHTS, ...customWeights }
    : null;

  const useDynamicWeights = !flags.staticWeights && !hasManualWeights;
  const useExpansion = !flags.noExpansion; // NEW: Respect --no-expansion flag

  const results = await searchWithBlend(query, {
    weights: manualWeights,
    useDynamicWeights,
    llmModel,
    useExpansion, // NEW: Pass expansion setting
  });

  displayResults(results, { showWeightReasoning: flags.showWeights });

  // Show weight config
  const effectiveWeights =
    results._metadata?.weights || manualWeights || DEFAULT_WEIGHTS;
  displayConfig(effectiveWeights, DEFAULT_OPTIONS);

  // Show weight reasoning if available
  if (flags.showWeights && results._metadata?.weightReasoning) {
    console.log("💭 Weight Reasoning:");
    console.log(`   ${results._metadata.weightReasoning}\n`);
  }

  // Export if requested
  if (flags.export) {
    await exportResults(results);
  }

  console.log("💡 Tip: Use --tune flag to adjust weights interactively");
  console.log(
    "💡 Tip: Use --compare flag to see results with different weight strategies",
  );
  console.log(
    "💡 Tip: Use --show-weights to see LLM reasoning for weight calculation\n",
  );
}

// Run if called directly
// Check if this file is being run directly (not imported)
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  main().catch((error) => {
    console.error("❌ Fatal error:", error.message);
    console.error(error.stack);
    process.exit(1);
  });
}

// Export for programmatic use
export {
  generateQueryEmbeddings,
  searchWithBlend,
  displayResults,
  interactiveTuning,
  runTestQueries,
  compareWeights,
  exportResults,
};
