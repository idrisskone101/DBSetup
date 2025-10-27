# Re-enrichment Solution - Quick Start

## Problem Summary

Your Supabase vector database has **over-canonicalized vibes and themes**:
- "dark comedy" was split into `["dark", "comedy"]` (separate atomic tokens)
- "psychological horror" became `["psychological", "horror"]` (lost semantic binding)
- Result: Searching for "dark comedy" returns horror movies because both have "dark" vibe

## Solution Overview

This solution **re-enriches your database** with updated LLM prompts that preserve compound descriptors:
- ✅ "dark comedy" stays as ONE vibe (not two)
- ✅ "psychological thriller" keeps context intact
- ✅ Themes use full phrases ("corruption of power" not "power")

## Files Created

### 1. Core Scripts
- **`llm-extractor.js`** ✅ UPDATED - New prompts preserve compound descriptors
- **`re-enrich-descriptive-metadata.js`** ✨ NEW - Smart re-enrichment with quality scoring
- **`test-descriptive-search.js`** ✨ NEW - Validation suite for search quality
- **`backup-current-metadata.js`** ✨ NEW - Backup utility before changes

### 2. Documentation
- **`REENRICHMENT_EXECUTION_GUIDE.md`** 📚 - Complete step-by-step execution guide

## Quick Start (5 Commands)

```bash
# 1. Backup current data (5 min)
node backup-current-metadata.js

# 2. Preview what will change (5 min)
node re-enrich-descriptive-metadata.js --dry-run --limit=100

# 3. Test on 50 records (30 min)
node re-enrich-descriptive-metadata.js --limit=50

# 4. Validate search quality (5 min)
node test-descriptive-search.js

# 5. If tests pass, run full re-enrichment (4-6 hours, overnight)
node re-enrich-descriptive-metadata.js --limit=1000
```

## Expected Results

### Before:
```json
{
  "vibes": ["dark", "comedy", "crime"],
  "themes": ["power", "betrayal", "family"],
  "quality_score": 35
}
```

**Problem:** "Dark comedy" search returns horror movies ❌

### After:
```json
{
  "vibes": ["dark comedy", "crime caper with dark humor", "satirical thriller"],
  "themes": ["corruption of power and moral decay", "betrayal within crime families", "dysfunctional family dynamics"],
  "quality_score": 85
}
```

**Fixed:** "Dark comedy" returns comedies with dark humor ✅

## Key Changes to LLM Prompts

### In `llm-extractor.js`:

#### EXTRACTION_SYSTEM_PROMPT (Wikipedia enrichment):
```
✅ GOOD EXAMPLES:
- "dark comedy" (NOT "dark" + "comedy" separately!)
- "psychological horror"
- "whimsical fantasy adventure"

❌ BAD EXAMPLES (over-atomized):
- "dark", "comedy" (separately) → This breaks semantic binding!
- "psychological", "horror" (separately) → Loses context!

CRITICAL RULES:
- PRESERVE COMPOUND DESCRIPTORS: "dark comedy" is ONE vibe, not two
- KEEP CONTEXT: "psychological thriller" is different from "psychological" + "thriller"
- BE DESCRIPTIVE: "corruption of power" > "power"
```

#### TMDB_INFERENCE_SYSTEM_PROMPT (TMDB fallback):
```
✅ GOOD INFERENCE:
- Genres: ["Comedy", "Crime"] + Keywords: ["dark humor"] 
  → Vibes: ["dark comedy", "crime caper"]

❌ BAD INFERENCE (atomic):
- "dark", "comedy" (separately) → Should be "dark comedy"!
```

## Validation Tests

The `test-descriptive-search.js` script runs 4 critical tests:

1. **"dark comedy"** → Should return 0 pure horror films
2. **"psychological thriller"** → Should have ≥5 compound vibes
3. **"whimsical fantasy"** → Should return ≤2 dark fantasy films
4. **"gritty crime noir"** → Should have ≥6 crime genre films

**Pass rate target:** ≥75% (ideally 100%)

## Safety & Rollback

### Backup is automatic:
```bash
node backup-current-metadata.js
# Creates: backup_metadata_1234567890.json
```

### Rollback if needed:
See `REENRICHMENT_EXECUTION_GUIDE.md` → "Rollback Plan" section

## Timeline

| Phase | Time | Unattended? |
|-------|------|-------------|
| Backup | 5 min | ✅ |
| Dry run | 5 min | ✅ |
| Small batch test | 30 min | ✅ |
| Validation | 5 min | ✅ |
| **Full re-enrichment** | **4-6 hours** | ✅ **Overnight** |
| Regenerate embeddings | 1-2 hours | ✅ |
| Final validation | 10 min | ✅ |

**Total: 6-9 hours (mostly unattended)**

## Next Steps

1. **Read the execution guide:**
   ```bash
   # Open in your editor
   code REENRICHMENT_EXECUTION_GUIDE.md
   ```

2. **Start with backup:**
   ```bash
   node backup-current-metadata.js
   ```

3. **Run dry-run to preview:**
   ```bash
   node re-enrich-descriptive-metadata.js --dry-run --limit=100
   ```

4. **Follow the 7-phase execution plan** in the guide

## Success Metrics

After completion:

✅ **Vibes:** 1,200-1,500 distinct (up from 635)  
✅ **Average vibe length:** 2.5+ words (up from 1.2)  
✅ **Average theme length:** 3.5+ words (up from 1.5)  
✅ **Quality score:** 70+/100 (up from 40-50)  
✅ **Search quality:** "Dark comedy" returns comedies, not horror  

## Troubleshooting

See `REENRICHMENT_EXECUTION_GUIDE.md` → "Troubleshooting" section for:
- API connection issues
- Rate limiting
- Validation failures
- Rollback procedures

## Support

All scripts include detailed logging and error handling. If you encounter issues:

1. Check the error message
2. Review dry-run output
3. Consult troubleshooting guide
4. Test single record manually

---

**Ready to fix your vector database?** Start with the backup and dry-run! 🚀

```bash
node backup-current-metadata.js
node re-enrich-descriptive-metadata.js --dry-run --limit=100
```
