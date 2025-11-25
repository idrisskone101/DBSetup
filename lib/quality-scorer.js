// Quality scoring system for enrichment validation
// Scores titles based on completeness of metadata fields
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
const config = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "scaling-config.json"),
    "utf-8",
  ),
);

const weights = config.quality_scoring.weights;
const thresholds = config.quality_scoring.thresholds;

/**
 * Calculate quality score for a single title
 * @param {Object} title - Title object from database
 * @returns {Object} - { score: number, breakdown: Object, tier: string }
 */
export function calculateQualityScore(title) {
  let score = 0;
  const breakdown = {
    slots_filled: 0,
    themes_present: 0,
    vibes_present: 0,
    tone_defined: 0,
    pacing_defined: 0,
    profile_string: 0,
  };

  // 1. Slots filled (0-48 points: 8 points per slot × 6 slots)
  if (title.slots) {
    const slots = [
      "protagonist",
      "setting_place",
      "setting_time",
      "goal",
      "obstacle",
      "stakes",
    ];
    const filledSlots = slots.filter(
      (slot) =>
        title.slots[slot] !== null &&
        title.slots[slot] !== undefined &&
        title.slots[slot].trim().length > 0,
    ).length;

    breakdown.slots_filled = filledSlots * weights.slots_filled;
    score += breakdown.slots_filled;
  }

  // 2. Themes present (0-15 points)
  if (Array.isArray(title.themes) && title.themes.length > 0) {
    const themeCount = title.themes.filter(
      (t) => t && t.trim().length > 0,
    ).length;
    if (themeCount >= 3) {
      breakdown.themes_present = weights.themes_present;
    } else if (themeCount === 2) {
      breakdown.themes_present = Math.floor(weights.themes_present * 0.67);
    } else if (themeCount === 1) {
      breakdown.themes_present = Math.floor(weights.themes_present * 0.33);
    }
    score += breakdown.themes_present;
  }

  // 3. Vibes present (0-15 points)
  if (Array.isArray(title.vibes) && title.vibes.length > 0) {
    const vibeCount = title.vibes.filter((v) => v && v.trim().length > 0).length;
    if (vibeCount >= 3) {
      breakdown.vibes_present = weights.vibes_present;
    } else if (vibeCount === 2) {
      breakdown.vibes_present = Math.floor(weights.vibes_present * 0.67);
    } else if (vibeCount === 1) {
      breakdown.vibes_present = Math.floor(weights.vibes_present * 0.33);
    }
    score += breakdown.vibes_present;
  }

  // 4. Tone defined (0-10 points)
  if (title.tone && title.tone.trim().length > 0) {
    breakdown.tone_defined = weights.tone_defined;
    score += breakdown.tone_defined;
  }

  // 5. Pacing defined (0-10 points)
  if (title.pacing && title.pacing.trim().length > 0) {
    breakdown.pacing_defined = weights.pacing_defined;
    score += breakdown.pacing_defined;
  }

  // 6. Profile string (0-2 points)
  if (title.profile_string && title.profile_string.trim().length > 0) {
    breakdown.profile_string = weights.profile_string;
    score += breakdown.profile_string;
  }

  // Determine quality tier
  let tier = "poor";
  if (score >= thresholds.excellent) {
    tier = "excellent";
  } else if (score >= thresholds.good) {
    tier = "good";
  } else if (score >= thresholds.fair) {
    tier = "fair";
  }

  return {
    score,
    breakdown,
    tier,
  };
}

/**
 * Calculate quality scores for multiple titles
 * @param {Array} titles - Array of title objects
 * @returns {Array} - Array of { id, title, score, breakdown, tier }
 */
export function calculateBatchQualityScores(titles) {
  return titles.map((title) => {
    const { score, breakdown, tier } = calculateQualityScore(title);
    return {
      id: title.id,
      title: title.title,
      score,
      breakdown,
      tier,
    };
  });
}

/**
 * Generate quality distribution report
 * @param {Array} scores - Array of quality score objects
 * @returns {Object} - Distribution statistics
 */
export function generateQualityReport(scores) {
  const distribution = {
    excellent: 0,
    good: 0,
    fair: 0,
    poor: 0,
  };

  const scoreValues = [];

  scores.forEach((s) => {
    distribution[s.tier]++;
    scoreValues.push(s.score);
  });

  const total = scores.length;
  const average =
    scoreValues.reduce((sum, s) => sum + s, 0) / (total || 1);
  const min = Math.min(...scoreValues);
  const max = Math.max(...scoreValues);

  // Calculate median
  const sorted = [...scoreValues].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

  return {
    total,
    distribution,
    percentages: {
      excellent: ((distribution.excellent / total) * 100).toFixed(1),
      good: ((distribution.good / total) * 100).toFixed(1),
      fair: ((distribution.fair / total) * 100).toFixed(1),
      poor: ((distribution.poor / total) * 100).toFixed(1),
    },
    statistics: {
      average: average.toFixed(1),
      median: median.toFixed(1),
      min,
      max,
    },
  };
}

/**
 * Identify low-quality titles that need re-enrichment
 * @param {Array} scores - Array of quality score objects
 * @param {number} threshold - Minimum acceptable score (default from config)
 * @returns {Array} - Array of low-quality title IDs
 */
export function identifyLowQualityTitles(
  scores,
  threshold = config.quality_scoring.re_enrich_threshold,
) {
  return scores.filter((s) => s.score < threshold).map((s) => s.id);
}

/**
 * Identify missing fields for a title
 * @param {Object} title - Title object
 * @returns {Object} - { slots: [], metadata: [] }
 */
export function identifyMissingFields(title) {
  const missing = {
    slots: [],
    metadata: [],
  };

  // Check slots
  if (title.slots) {
    const slots = [
      "protagonist",
      "setting_place",
      "setting_time",
      "goal",
      "obstacle",
      "stakes",
    ];
    slots.forEach((slot) => {
      if (
        !title.slots[slot] ||
        title.slots[slot].trim().length === 0
      ) {
        missing.slots.push(slot);
      }
    });
  } else {
    missing.slots = [
      "protagonist",
      "setting_place",
      "setting_time",
      "goal",
      "obstacle",
      "stakes",
    ];
  }

  // Check metadata
  if (!title.themes || title.themes.length < config.quality_scoring.min_themes) {
    missing.metadata.push("themes");
  }
  if (!title.vibes || title.vibes.length < config.quality_scoring.min_vibes) {
    missing.metadata.push("vibes");
  }
  if (!title.tone || title.tone.trim().length === 0) {
    missing.metadata.push("tone");
  }
  if (!title.pacing || title.pacing.trim().length === 0) {
    missing.metadata.push("pacing");
  }
  if (!title.profile_string || title.profile_string.trim().length === 0) {
    missing.metadata.push("profile_string");
  }

  return missing;
}

/**
 * Print quality report to console
 * @param {Object} report - Quality report object
 */
export function printQualityReport(report) {
  console.log("\n" + "━".repeat(60));
  console.log("📊 QUALITY REPORT");
  console.log("━".repeat(60));
  console.log(`Total titles analyzed: ${report.total}`);
  console.log("\n📈 Distribution:");
  console.log(
    `   ✨ Excellent (90-100): ${report.distribution.excellent} (${report.percentages.excellent}%)`,
  );
  console.log(
    `   ✅ Good (70-89):      ${report.distribution.good} (${report.percentages.good}%)`,
  );
  console.log(
    `   ⚠️  Fair (50-69):      ${report.distribution.fair} (${report.percentages.fair}%)`,
  );
  console.log(
    `   ❌ Poor (0-49):       ${report.distribution.poor} (${report.percentages.poor}%)`,
  );
  console.log("\n📊 Statistics:");
  console.log(`   Average score: ${report.statistics.average}`);
  console.log(`   Median score:  ${report.statistics.median}`);
  console.log(`   Min score:     ${report.statistics.min}`);
  console.log(`   Max score:     ${report.statistics.max}`);
  console.log("━".repeat(60) + "\n");
}
