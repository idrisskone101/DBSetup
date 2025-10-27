# Wikipedia Pipeline & LLM Fallback Improvements

## Overview

This document describes the improvements made to the Wikipedia enrichment pipeline to fix the **103 titles (51.5%)** that were missing vibes and tone data.

## Problem Identified

**Data Quality Audit Results:**
- **103 titles (51.5%)** missing both vibes AND tone
- **24 titles (12%)** missing keywords
- **127 titles (63.5%)** missing Wikipedia source attribution
- **3 titles** completely empty (no data at all)

**Root Causes:**
1. Wikipedia disambiguation pages not being handled properly
2. Insufficient title pattern matching (missing TV show patterns)
3. No fallback when Wikipedia content was too sparse
4. No LLM inference from TMDB metadata when Wikipedia failed

## Solutions Implemented

### 1. Enhanced Wikipedia Fetcher (`wikipedia-fetcher.js`)

**Improvements:**
- ✅ Added TV show disambiguation patterns:
  - `(YEAR TV series)` - e.g., "The Crown (2016 TV series)"
  - `(American TV series)` - e.g., "The Office (American TV series)"
  - `(British TV series)` - e.g., "The Office (British TV series)"
  - `(U.S. TV series)` and `(UK TV series)` variants
- ✅ Better pattern ordering (most specific → least specific)
- ✅ Improved disambiguation detection:
  - Checks for "may refer to" in content
  - Skips disambiguation pages automatically
- ✅ Added year-based patterns for older movies/shows

**Example Patterns Tried (in order):**
```javascript
// For Movies:
"Interstellar (2014 film)"
"Interstellar (film)"
"Interstellar (2014)"
"Interstellar"

// For TV Shows:
"The Office (2005 TV series)"
"The Office (American TV series)"
"The Office (British TV series)"
"The Office (U.S. TV series)"
"The Office (TV series)"
"The Office (2005)"
"The Office"
```

### 2. Conservative Defaults System (`conservative-defaults.js`)

**Purpose:** Provide sensible fallback metadata when all other methods fail.

**Features:**
- Genre-based default vibes, tone, and pacing
- Era-based tone modifiers (pre-1960s → "classic and earnest")
- Content type modifiers (TV → "episodic")
- Quality validation to detect generic metadata

**Example Mappings:**
```javascript
{
  "Horror": { 
    vibes: ["suspenseful horror", "eerie"], 
    tone: "tense", 
    pacing: "slow-burn" 
  },
  "Action": { 
    vibes: ["high-octane action", "adrenaline-fueled"], 
    tone: "intense", 
    pacing: "kinetic" 
  },
  "Drama": { 
    vibes: ["emotional drama", "character-driven"], 
    tone: "earnest", 
    pacing: "contemplative" 
  }
}
```

### 3. LLM-Based TMDB Inference (`llm-extractor.js`)

**New Capability:** When Wikipedia fails, infer metadata from TMDB structured data.

**Inputs Used:**
- Genres (e.g., `["Action", "Thriller"]`)
- Keywords (e.g., `["revenge", "betrayal", "mafia"]`)
- Overview (short synopsis)
- Tagline (marketing one-liner)
- Cast/Director names (context clues)
- Release year

**LLM Prompt Strategy:**
- Transform genres into descriptive vibes (not just "action", but "high-octane action")
- Extract themes from keywords ("revenge" → "vengeance and betrayal")
- Infer tone from genre combinations (Horror + "supernatural" → "tense and eerie")
- Infer pacing from genre (Action → "kinetic", Drama → "contemplative")

**Quality Validation:**
- Rejects generic vibes (just genre names)
- Requires at least 2 vibes and 1 tone
- Flags low-quality extractions for fallback

### 4. 4-Tier Fallback Chain (`enrich-titles.js`)

**The Pipeline:**

```
┌─────────────────────────────────────────────────────────────┐
│ TIER 1: Wikipedia Content                                   │
│ ✓ Fetch Wikipedia article with improved patterns            │
│ ✓ Extract metadata from summary + plot (≥400 chars)         │
│ ✓ Validate quality (≥2 vibes, descriptive tone)            │
└─────────────────────────────────────────────────────────────┘
                            ↓ (if fails)
┌─────────────────────────────────────────────────────────────┐
│ TIER 2: TMDB Overview + LLM Extraction                      │
│ ✓ Use TMDB overview text (≥100 chars)                      │
│ ✓ Extract metadata with LLM                                 │
│ ✓ Validate quality                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓ (if fails)
┌─────────────────────────────────────────────────────────────┐
│ TIER 3: TMDB Structured Data Inference                      │
│ ✓ Infer from genres, keywords, tagline, cast                │
│ ✓ LLM generates vibes/tone/themes from structured data      │
│ ✓ Validate quality                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓ (if fails)
┌─────────────────────────────────────────────────────────────┐
│ TIER 4: Conservative Genre-Based Defaults                   │
│ ✓ Use genre mappings for vibes/tone/pacing                 │
│ ✓ Apply era modifiers (pre-1960s → "classic")              │
│ ✓ Apply content type modifiers (TV → "episodic")           │
└─────────────────────────────────────────────────────────────┘
```

**Method Tracking:**
Each enrichment now reports which method succeeded:
- `wikipedia` - Best quality (full Wikipedia content)
- `tmdb_overview` - Good quality (TMDB synopsis)
- `tmdb_inference` - Inferred quality (genres/keywords)
- `defaults` - Conservative fallback (genre mappings)

### 5. Re-Enrichment Script (`re-enrich-missing.js`)

**Purpose:** Batch re-process the 103 titles with missing data.

**Features:**
- Targets titles with missing vibes OR tone
- Dry-run mode to preview what would be enriched
- Filter by kind (movies vs TV shows)
- Force mode to re-enrich ALL titles
- Method statistics tracking
- Success rate analysis

**Usage:**
```bash
# See what would be enriched
npm run re-enrich:dry-run

# Re-enrich all titles with missing vibes/tone
npm run re-enrich

# Re-enrich only movies
npm run re-enrich:movies

# Re-enrich only TV shows
npm run re-enrich:tv

# Re-enrich a specific title by ID
node re-enrich-missing.js --id 1402

# Limit to first 10 titles (for testing)
node re-enrich-missing.js --limit 10

# Force re-enrich ALL titles (even those with data)
node re-enrich-missing.js --force
```

## Expected Improvements

### Before:
- ❌ 103 titles (51.5%) missing vibes/tone
- ❌ Poor Wikipedia disambiguation handling
- ❌ No fallback for sparse content
- ❌ 3 completely empty records

### After:
- ✅ **Target: <10% missing vibes/tone** (reduce from 51.5%)
- ✅ All titles have at least conservative defaults
- ✅ Better Wikipedia hit rate (more patterns)
- ✅ LLM fallback generates quality metadata from TMDB
- ✅ Clear method tracking for analytics

## Testing Plan

### 1. Test Problem Titles (Sample)

Run enrichment on known problem titles:

```bash
# The Walking Dead (id: 1402) - missing vibes/tone
node run-enrichment.js --id 1402

# Dexter (id: 1405) - missing vibes/tone
node run-enrichment.js --id 1405

# Die Küchenschlacht (id: 46034) - completely empty
node run-enrichment.js --id 46034
```

Expected outcomes:
- Wikipedia patterns should find TV show pages
- If Wikipedia fails, TMDB inference should work
- At minimum, genre-based defaults applied

### 2. Batch Re-Enrichment

```bash
# First, dry run to see what will be processed
npm run re-enrich:dry-run

# Then re-enrich in batches
npm run re-enrich -- --limit 20  # Start with 20 titles
npm run re-enrich                 # Then do all remaining
```

Monitor method distribution:
- Ideally: 40%+ Wikipedia, 30%+ TMDB overview/inference
- Acceptable: 20%+ defaults (for obscure titles)

### 3. Quality Validation

After re-enrichment, query to verify:

```sql
-- Count titles by enrichment status
SELECT 
  COUNT(*) as total,
  COUNT(vibes) as has_vibes,
  COUNT(tone) as has_tone,
  ROUND(100.0 * COUNT(vibes) / COUNT(*), 2) as vibes_pct,
  ROUND(100.0 * COUNT(tone) / COUNT(*), 2) as tone_pct
FROM titles;

-- Check for generic vibes (just genre names)
SELECT id, title, vibes, genres
FROM titles
WHERE vibes && ARRAY['action', 'drama', 'comedy', 'thriller'];
```

Target metrics:
- ✅ Vibes coverage: >90%
- ✅ Tone coverage: >90%
- ✅ <5% generic vibes (just genre names)

## Files Modified/Created

### Modified:
1. `wikipedia-fetcher.js` - Better patterns & disambiguation
2. `llm-extractor.js` - Added TMDB inference & quality validation
3. `enrich-titles.js` - 4-tier fallback chain
4. `run-enrichment.js` - Method statistics display
5. `package.json` - Added re-enrichment scripts

### Created:
1. `conservative-defaults.js` - Genre-based defaults
2. `re-enrich-missing.js` - Batch re-enrichment script
3. `ENRICHMENT_IMPROVEMENTS.md` - This document

## Next Steps

1. **Test on sample titles** (run commands above)
2. **Run batch re-enrichment** on the 103 problem titles
3. **Analyze method distribution** (Wikipedia vs TMDB vs defaults)
4. **Validate data quality** (SQL queries above)
5. **Regenerate embeddings** for re-enriched titles (if vibe/tone changed significantly)

## Monitoring

After re-enrichment, track these metrics:
- Method distribution (which tier worked most often?)
- Success rate (% of titles enriched)
- Data quality (% with rich, descriptive vibes vs generic)
- Coverage (% with vibes AND tone)

Goal: **<10% missing vibes/tone** (down from 51.5%)
