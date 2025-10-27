# Re-enrichment Execution Guide
## Fixing Over-Canonicalized Vector Database

**Problem:** Aggressive canonicalization split compound vibes/themes into atomic tokens, causing semantic collapse in vector search.

**Solution:** Re-enrich with updated LLM prompts that preserve compound descriptors like "dark comedy" and "psychological thriller".

---

## Prerequisites Checklist

- [ ] Node.js installed
- [ ] All dependencies installed (`npm install`)
- [ ] `.env` file configured with:
  - `OPENAI_API_KEY=sk-...`
  - `DATABASE_URL=postgresql://...`
  - `SUPABASE_ANON_KEY=...` or `SUPABASE_SERVICE_ROLE_KEY=...`
- [ ] Supabase vector search function exists (`match_titles_vibe`)
- [ ] At least 2-3 hours for initial testing, 6-9 hours for full re-enrichment

---

## Quick Start Commands

```bash
# 1. Backup (5 min)
node -e "require('./backup-current-metadata.js')"

# 2. Dry run (5 min)
node re-enrich-descriptive-metadata.js --dry-run --limit=100

# 3. Small test batch (30 min)
node re-enrich-descriptive-metadata.js --limit=50

# 4. Validate (5 min)
node test-descriptive-search.js

# 5. Full re-enrichment (4-6 hours, run overnight)
node re-enrich-descriptive-metadata.js --limit=1000

# 6. Regenerate embeddings (1-2 hours)
node generate-multi-embeddings-backfill.js

# 7. Final validation (5 min)
node test-descriptive-search.js
```

---

## Phase 1: Backup Current Data (5 minutes)

**CRITICAL:** Always backup before making changes!

### Option A: Quick JSON Backup

Create `backup-current-metadata.js`:

```javascript
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const match = databaseUrl.match(/db\.([^.]+)\.supabase\.co/);
const projectRef = match[1];
const supabaseUrl = `https://${projectRef}.supabase.co`;

const supabase = createClient(
  supabaseUrl,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function backup() {
  const { data, error } = await supabase
    .from("titles")
    .select("id, title, vibes, themes, tone, pacing");

  if (error) throw error;

  const filename = `backup_metadata_${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  console.log(`✅ Backup saved to ${filename}`);
  console.log(`   Records: ${data.length}`);
}

backup().catch(console.error);
```

Run:
```bash
node backup-current-metadata.js
```

**Expected output:**
```
✅ Backup saved to backup_metadata_1234567890.json
   Records: 990
```

### Option B: SQL Backup (recommended for large datasets)

```bash
# Export to CSV
psql $DATABASE_URL -c "COPY (SELECT id, title, vibes, themes, tone, pacing FROM titles) TO STDOUT CSV HEADER" > backup_metadata.csv
```

---

## Phase 2: Dry Run Analysis (5 minutes)

Preview what will be updated without making changes:

```bash
node re-enrich-descriptive-metadata.js --dry-run --limit=100
```

**What to look for:**

✅ **Good signs:**
```
📊 Total titles fetched: 100
📋 Candidates for re-enrichment: 67
   - Over-canonicalized vibes: 45
   - Over-canonicalized themes: 52

🔍 DRY RUN MODE - Showing sample candidates:

📽️  The Dark Knight (ID: 123)
   Current vibes: dark, action, thriller
   Current themes: justice, identity, chaos
   Quality score: 35/100
```

❌ **Bad signs:**
- Error connecting to database
- No candidates found (all quality scores already high)
- All candidates have quality score > 60 (already good)

**If no candidates found:** Your metadata is already high quality! Skip to validation tests.

---

## Phase 3: Small Test Batch (30 minutes)

Test on 50 records to validate the approach:

```bash
node re-enrich-descriptive-metadata.js --limit=50
```

**Monitor the output:**

```
[1/50] Re-enriching: The Dark Knight
   Old quality score: 35/100
   Old vibes: dark, action, thriller
   Old themes: justice, identity, chaos
   
   📖 [Tier 1] Attempting Wikipedia fetch...
   ✅ [Tier 1] Wikipedia content (2450 chars)
   ✅ [Tier 1] High-quality metadata from Wikipedia
   
   📊 Final metadata (method: wikipedia):
      Themes: corruption of power and moral decay, vigilante justice, duality of hero and villain
      Vibes: dark superhero thriller, psychological crime drama, gritty action
      Tone: intense and brooding
      Pacing: kinetic
   
   ✅ New quality score: 85/100
   New vibes: dark superhero thriller, psychological crime drama, gritty action
   New themes: corruption of power and moral decay, vigilante justice, duality of hero and villain
   
   🎉 IMPROVED by 50 points!
```

**Success metrics for Phase 3:**
- [ ] At least 30/50 records show "IMPROVED" (60%+)
- [ ] Average quality score increase: +20 points or more
- [ ] Vibes are now compound (2+ words per vibe)
- [ ] Themes are now descriptive phrases (3+ words per theme)
- [ ] No major errors or API failures

**If Phase 3 fails:**
1. Check API keys are valid
2. Verify Wikipedia/TMDB connectivity
3. Review sample output for quality issues
4. Consider adjusting prompts in `llm-extractor.js`

---

## Phase 4: Validation Tests (5 minutes)

After the small batch, test if search quality improved:

```bash
node test-descriptive-search.js
```

**Expected output:**

```
🧪 Running Descriptive Search Validation Tests
================================================================================

📝 Test: "dark comedy"
   Expected: Should return comedies with dark humor, NOT pure horror films

   Top 10 Results:
   1. Dr. Strangelove
      Genres: comedy, war
      Vibes: dark comedy, satirical anti-war film, absurdist humor
      Similarity: 0.892
   
   2. Fargo
      Genres: crime, comedy, thriller
      Vibes: dark comedy, crime caper with dark humor, quirky thriller
      Similarity: 0.878
   
   3. In Bruges
      Genres: crime, comedy, drama
      Vibes: dark comedy, existential crime drama
      Similarity: 0.865
   
   ✅ PASSED: Found 0 pure horror films in top 10 (should be 0)

--------------------------------------------------------------------------------

📊 Validation Summary:
   Total tests: 4
   ✅ Passed: 4
   ❌ Failed: 0
   Success rate: 100.0%

🎉 All tests passed! Search quality is excellent.
```

**Success criteria:**
- [ ] "Dark comedy" test: 0 pure horror films ✅
- [ ] "Psychological thriller" test: ≥5 compound vibes ✅
- [ ] "Whimsical fantasy" test: ≤2 dark fantasy films ✅
- [ ] "Gritty crime noir" test: ≥6 crime genre films ✅
- [ ] Overall pass rate: ≥75%

**If tests fail:**

1. **"Dark comedy" returns horror films:**
   - Prompts still allowing atomic "dark" + "comedy" split
   - Edit `llm-extractor.js` EXTRACTION_SYSTEM_PROMPT
   - Add more explicit examples

2. **"Psychological thriller" has atomic vibes:**
   - LLM still splitting compound descriptors
   - Strengthen "PRESERVE COMPOUND DESCRIPTORS" rule in prompts
   - Add validation check in `isMetadataHighQuality()`

3. **Test script errors:**
   - Check `match_titles_vibe` function exists in Supabase
   - Verify embeddings are generated (run `generate-multi-embeddings-backfill.js`)

---

## Phase 5: Full Re-enrichment (4-6 hours)

**RECOMMENDED:** Run this overnight or during low-activity hours.

Once Phase 3 + 4 validate the approach, process all candidates:

```bash
# Run in background (Linux/Mac)
nohup node re-enrich-descriptive-metadata.js --limit=1000 > re_enrichment.log 2>&1 &

# Or Windows PowerShell
Start-Process -NoNewWindow node -ArgumentList "re-enrich-descriptive-metadata.js","--limit=1000" -RedirectStandardOutput re_enrichment.log
```

**Monitor progress:**

```bash
# Linux/Mac
tail -f re_enrichment.log

# Windows PowerShell
Get-Content re_enrichment.log -Wait -Tail 50
```

**Rate limiting:**
- Script waits 2 seconds between API calls
- ~1800 API calls per hour (well under OpenAI/Wikipedia limits)
- Expected time: ~4-6 hours for 1000 records

**What to expect:**

```
[1/850] Re-enriching: Title 1
   🎉 IMPROVED by 45 points!
   ⏸️  Waiting 2000ms...

[2/850] Re-enriching: Title 2
   🎉 IMPROVED by 30 points!
   ⏸️  Waiting 2000ms...

...

[850/850] Re-enriching: Title 850
   ✅ New quality score: 70/100


📊 Re-enrichment Summary:
   Total processed: 850
   ✅ Success: 820
   🎉 Improved: 735
   ⚠️  No change: 85
   ❌ Failed: 30

✅ Re-enrichment complete!
```

**Success metrics for Phase 5:**
- [ ] Success rate: ≥85% (improved + no change)
- [ ] Improvement rate: ≥65% (improved / success)
- [ ] Failed rate: ≤10%

---

## Phase 6: Regenerate Vector Embeddings (1-2 hours)

After re-enrichment, **embeddings MUST be regenerated** to reflect new metadata:

### Step 1: Check if embedding script exists

```bash
ls generate-multi-embeddings-backfill.js
```

If not found, use your existing embedding generation script.

### Step 2: Regenerate vibe embeddings (ALL records)

```bash
# Vibes changed significantly - regenerate for ALL titles
node generate-multi-embeddings-backfill.js --embedding-type=vibe --batch-size=100
```

### Step 3: Regenerate content embeddings (if themes changed)

```bash
# Only if themes were significantly updated
node generate-multi-embeddings-backfill.js --embedding-type=content --batch-size=100
```

**Expected output:**

```
🚀 Starting multi-embedding backfill
   Embedding type: vibe
   Batch size: 100

Batch 1/10: Processing records 1-100...
✅ Batch 1 complete (100 embeddings generated)

Batch 2/10: Processing records 101-200...
✅ Batch 2 complete (100 embeddings generated)

...

✅ Embedding backfill complete!
   Total records: 990
   Embeddings generated: 990
   Errors: 0
```

**If embedding script doesn't exist or errors:**

Use this minimal version:

```javascript
// generate-embeddings-simple.js
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(/* your config */);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function regenerateVibeEmbeddings() {
  const { data: titles } = await supabase.from("titles").select("*");

  for (const title of titles) {
    const vibeText = `Vibes: ${title.vibes?.join(", ")}. Tone: ${title.tone}. Pacing: ${title.pacing}`;
    
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: vibeText,
    });

    const embedding = response.data[0].embedding;

    await supabase
      .from("titles")
      .update({ vibe_embedding: embedding })
      .eq("id", title.id);

    console.log(`✅ Updated embedding for: ${title.title}`);
    await new Promise((r) => setTimeout(r, 100)); // Rate limit
  }
}

regenerateVibeEmbeddings().catch(console.error);
```

---

## Phase 7: Final Validation (10 minutes)

Run the full test suite to confirm improvements:

```bash
node test-descriptive-search.js
```

**Success criteria (final):**
- [ ] All 4 tests pass (100%) ✅
- [ ] "Dark comedy" returns 0 horror-only films ✅
- [ ] Compound vibes present in search results ✅
- [ ] Search results are semantically relevant ✅

**If tests still fail after re-enrichment:**

1. **Check a specific failed title manually:**
```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(/* config */);

supabase
  .from('titles')
  .select('title, vibes, themes')
  .eq('title', 'The Dark Knight')
  .single()
  .then(({ data }) => console.log(data));
"
```

2. **Verify vibes are compound:**
```sql
SELECT 
  title,
  vibes,
  array_length(vibes, 1) as vibe_count,
  (SELECT AVG(array_length(regexp_split_to_array(v, '\s+'), 1)) 
   FROM unnest(vibes) AS v) as avg_words_per_vibe
FROM titles
WHERE id = 123;
```

Expected: `avg_words_per_vibe >= 2.0`

3. **Check if embeddings were regenerated:**
```sql
SELECT COUNT(*) FROM titles WHERE vibe_embedding IS NULL;
```

Expected: `0`

---

## Rollback Plan

If results are **worse** than before:

### Step 1: Restore metadata from backup

```javascript
// restore-from-backup.js
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const backup = JSON.parse(fs.readFileSync("backup_metadata_[timestamp].json"));
const supabase = createClient(/* config */);

for (const record of backup) {
  await supabase
    .from("titles")
    .update({
      vibes: record.vibes,
      themes: record.themes,
      tone: record.tone,
      pacing: record.pacing,
    })
    .eq("id", record.id);
}

console.log("✅ Rollback complete");
```

Run:
```bash
node restore-from-backup.js
```

### Step 2: Regenerate embeddings from restored metadata

```bash
node generate-multi-embeddings-backfill.js --embedding-type=vibe
```

### Step 3: Validate rollback worked

```bash
node test-descriptive-search.js
```

---

## Estimated Timeline

| Phase | Duration | Can Run Unattended? |
|-------|----------|---------------------|
| 1. Backup | 5 min | Yes |
| 2. Dry run | 5 min | Yes |
| 3. Small batch | 30 min | Yes |
| 4. Validation | 5 min | Yes |
| 5. Full re-enrichment | 4-6 hours | **Yes** ⭐ |
| 6. Regenerate embeddings | 1-2 hours | **Yes** ⭐ |
| 7. Final validation | 10 min | Yes |

**Total: 6-9 hours (mostly unattended)**

---

## Success Metrics

### Before Re-enrichment:
- Vibes: 635 distinct values (over-canonicalized)
- Average vibe length: 1.2 words
- Average theme length: 1.5 words
- Quality score: 40-50/100
- "Dark comedy" search: Returns horror films ❌

### After Re-enrichment:
- Vibes: 1,200-1,500 distinct values (descriptive)
- Average vibe length: 2.5+ words ✅
- Average theme length: 3.5+ words ✅
- Quality score: 70+/100 ✅
- "Dark comedy" search: Returns comedies with dark humor ✅

### Measure improvement:

```sql
-- Average words per vibe
SELECT 
  AVG(
    (SELECT AVG(array_length(regexp_split_to_array(v, '\s+'), 1)) 
     FROM unnest(vibes) AS v)
  ) as avg_words_per_vibe
FROM titles;

-- Average words per theme
SELECT 
  AVG(
    (SELECT AVG(array_length(regexp_split_to_array(t, '\s+'), 1)) 
     FROM unnest(themes) AS t)
  ) as avg_words_per_theme
FROM titles;

-- Distinct vibe/theme counts
SELECT 
  (SELECT COUNT(DISTINCT v) FROM (SELECT unnest(vibes) AS v FROM titles) sub) as distinct_vibes,
  (SELECT COUNT(DISTINCT t) FROM (SELECT unnest(themes) AS t FROM titles) sub) as distinct_themes;
```

**Target metrics:**
- `avg_words_per_vibe`: ≥2.0
- `avg_words_per_theme`: ≥2.5
- `distinct_vibes`: 1200-1500
- `distinct_themes`: 1800-2200

---

## Troubleshooting

### "Error fetching titles"
- Check DATABASE_URL is correct
- Verify SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is set
- Test connection: `psql $DATABASE_URL -c "SELECT COUNT(*) FROM titles"`

### "OpenAI API error: 429 Rate Limit"
- Default script includes 2s delays between requests (well under limits)
- If still hitting limits, increase delay in re-enrich script
- Check your OpenAI usage/quota

### "All enrichment tiers failed"
- Wikipedia API may be temporarily down - retry later
- OPENAI_API_KEY may be invalid - verify in dashboard
- Check internet connectivity

### "No significant improvement"
- Common for titles that already had good metadata
- Review specific examples to ensure prompts are working
- If >50% show "no change", may need to strengthen prompts

### "match_titles_vibe function does not exist"
- You need to create the Supabase vector search function
- Check `create-multi-embedding-search-function.sql`
- Or use your existing vector search function name

---

## Next Steps After Completion

1. **Monitor search quality** over next few days
2. **Set up validation** to run weekly
3. **Prevent regression:** Add validation to enrichment pipeline
4. **Document learnings:** Update prompts based on results
5. **Scale to more records:** Apply to remaining titles if successful

---

## Support & Questions

If you encounter issues not covered here:

1. Check the specific error message
2. Review the dry-run output for clues
3. Test on a single record manually
4. Verify all prerequisites are met
5. Check API connectivity and keys

---

**Good luck with your re-enrichment!** 🚀

The result should be a significantly improved vector search experience where compound queries like "dark comedy" return contextually relevant results instead of over-canonicalized matches.
