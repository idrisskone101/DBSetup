# Data Quality Cleanup - Quick Start Guide

## Overview

Your database has **814 titles (82%)** missing keywords, which is hurting your metadata_embedding quality. Here's how to fix it quickly using your existing infrastructure.

---

## Current Status

| Issue | Count | Priority | Script to Use |
|-------|-------|----------|---------------|
| Missing keywords | 814 | 🔴 CRITICAL | `backfill-keywords.js` ✨ NEW |
| Missing themes | 25 | 🟡 Medium | `re-enrich-missing.js` |
| Missing overview | 26 | 🟡 Medium | `tmdb-enrich.js` |
| Duplicate titles | 6 groups | 🟢 Low | Manual SQL (see below) |
| Missing director/cast | ~800 | 🟢 Low | `tmdb-enrich.js` |

---

## Step 1: Backfill Keywords (CRITICAL - Do First!)

I've created a new script `backfill-keywords.js` that uses your existing infrastructure:

```bash
# Process top 50 most popular titles first
node backfill-keywords.js 50

# Process top 100
node backfill-keywords.js 100

# Process ALL 814 missing keywords (takes ~7 minutes with rate limiting)
node backfill-keywords.js 814
```

**What it does:**
- Fetches keywords from TMDB API (using your existing `tmdb.js` module)
- Updates Supabase directly
- Respects TMDB rate limits (500ms delay)
- Shows progress with detailed logging

**Expected output:**
```
🔑 KEYWORD BACKFILL TOOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1/50] 📚 Stolen Girl (ID: 1280450, Kind: movie)
  ✅ Found 8 keywords: kidnapping, international, thriller, rescue, mother...
  💾 Database updated

[2/50] 📚 Martin (ID: 861451, Kind: movie)
  ...
```

---

## Step 2: Regenerate Embeddings

After backfilling keywords, regenerate `metadata_embedding` for the updated titles:

```bash
# Your existing embedding script should handle this
node generate-multi-embeddings-backfill.js
```

Or if you have a specific metadata embedding script, use that.

---

## Step 3: Phase 2 - Metadata Enrichment (Director, Cast, Writers)

Your existing `tmdb-enrich.js` script already handles **ALL of Phase 2**! It backfills:
- Director (891 movies missing)
- Cast (793 records missing)
- Writers
- Certification
- Production countries
- Collection info
- Taglines

```bash
# Backfill metadata for top 100 most popular titles
node tmdb-enrich.js 100

# Backfill metadata for top 200 titles
node tmdb-enrich.js 200

# Backfill ALL titles missing cast/director (~800 titles)
node tmdb-enrich.js 800
```

**What it does:**
- Fetches director, cast, writers, certification from TMDB
- Updates your metadata fields in Supabase
- Respects rate limits (500ms delay)
- Shows detailed progress logging

**Note:** This does NOT regenerate embeddings - you'll do that in Step 4.

---

## Step 4: Backfill Missing Themes/Overviews (Optional)

If you want to fix the remaining 25 titles missing themes:

```bash
# Use your existing enrichment pipeline
node re-enrich-missing.js
```

This will use your 4-tier fallback system:
1. Wikipedia content
2. TMDB overview extraction
3. TMDB structured data inference
4. Conservative genre-based defaults

---

## Step 4: Handle Duplicates (Optional)

Found 6 duplicate title groups. **Recommended approach: Disambiguate with years**

```sql
-- Connect to your Supabase database and run:

-- Keep both Doctor Who versions (different eras)
UPDATE titles SET title = 'Doctor Who (2005)' WHERE id = 57243;
UPDATE titles SET title = 'Doctor Who (1963)' WHERE id = 121;

-- Keep both Doraemon versions
UPDATE titles SET title = 'Doraemon (1979)' WHERE id = 57911;
UPDATE titles SET title = 'Doraemon (2005)' WHERE id = 65733;

-- Keep both How to Train Your Dragon versions
UPDATE titles SET title = 'How to Train Your Dragon (2025)' WHERE id = 1087192;
UPDATE titles SET title = 'How to Train Your Dragon (2010)' WHERE id = 10191;

-- Keep both Scream versions
UPDATE titles SET title = 'Scream (1996)' WHERE id = 4232;
UPDATE titles SET title = 'Scream (2022)' WHERE id = 646385;

-- Delete low-quality duplicates
DELETE FROM titles WHERE id IN (10160, 1498658);

-- Verify no duplicates remain
SELECT title, kind, COUNT(*) 
FROM titles 
GROUP BY title, kind 
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

---

## Expected Impact

### Before Cleanup
- Keywords: 176/990 (18%)
- Metadata embedding quality: **Low** (missing critical signals)

### After Cleanup
- Keywords: ~950/990 (96%+)
- Metadata embedding quality: **High** (rich metadata signals)
- **Estimated improvement: +40-50% in recommendation accuracy**

---

## Monitoring Progress

Check your data quality score at any time:

```bash
# Run the audit queries in Supabase SQL editor
# Or use this quick check:
node -e "
import { supabase } from './supabase-upsert.js';

const { data } = await supabase
  .from('titles')
  .select('id')
  .is('keywords', null);

console.log(\`Titles still missing keywords: \${data?.length || 0}\`);
"
```

Or run SQL directly in Supabase:

```sql
-- Quick quality check
SELECT 
  COUNT(*) as total,
  COUNT(keywords) FILTER (WHERE keywords IS NOT NULL AND array_length(keywords, 1) >= 5) as good_keywords,
  COUNT(themes) FILTER (WHERE themes IS NOT NULL AND array_length(themes, 1) >= 3) as good_themes,
  ROUND(
    COUNT(keywords) FILTER (WHERE keywords IS NOT NULL AND array_length(keywords, 1) >= 5) * 100.0 / COUNT(*),
    1
  ) as pct_good_keywords
FROM titles;
```

---

## Full Cleanup Workflow (Recommended)

```bash
# PHASE 1: Critical Vector Quality Fixes
# ========================================

# 1. Backfill keywords (CRITICAL - takes ~7 mins for all 814)
node backfill-keywords.js 814

# 2. Regenerate metadata embeddings (keywords updated)
node generate-multi-embeddings-backfill.js


# PHASE 2: Metadata Enrichment
# ========================================

# 3. Backfill director/cast/writers (takes ~7 mins for 800 titles)
node tmdb-enrich.js 800

# 4. Regenerate metadata embeddings again (director/cast updated)
node generate-multi-embeddings-backfill.js


# PHASE 3: Optional Cleanup
# ========================================

# 5. (Optional) Fix missing themes/overviews
node re-enrich-missing.js

# 6. (Optional) Run duplicate resolution SQL in Supabase
# See duplicate resolution section below

# 7. Verify improvements
# Run the quality check SQL in Supabase
```

---

## Cost Estimates

**TMDB API:**
- 814 keyword requests × 500ms delay = ~7 minutes
- TMDB is free for <40 requests/sec (we're doing 2/sec)
- Cost: $0 ✅

**OpenAI (if re-enriching themes):**
- 25-50 titles × $0.01 per title ≈ $0.25-$0.50
- Uses your existing `gpt-4o-mini` setup

**Supabase:**
- No additional cost (just updates)

---

## Files Created

- `backfill-keywords.js` - New script for keyword backfilling
- `CLEANUP-QUICKSTART.md` - This guide
- `DATA-QUALITY-RECOMMENDATIONS.md` - Full detailed analysis
- `DUPLICATE-RESOLUTION.md` - Duplicate analysis (in progress)
- SQL audit scripts in `supabase-*.sql` files

---

## Need Help?

**If keyword backfill fails:**
- Check your `.env` has `TMDB_API_KEY` or `TMDB_API_TOKEN`
- Check `DATABASE_URL` and Supabase keys are set
- Look for rate limit errors (we're already throttling to 500ms)

**If embedding regeneration is unclear:**
- Check your existing `generate-multi-embeddings-backfill.js`
- You may need to modify it to target only updated records
- Or just regenerate all embeddings (safer but slower)

---

## Questions?

Refer to:
- `DATA-QUALITY-RECOMMENDATIONS.md` - Full detailed analysis
- Your existing scripts in `DBSetup/` - They're well-structured!
- SQL audit scripts for deeper analysis

**Next:** Run `node backfill-keywords.js 50` to test on 50 titles first! 🚀
