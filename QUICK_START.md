# Quick Start: Re-Enriching Missing Data

## The Problem

Your database has **103 titles (51.5%)** missing vibes and tone because:
- Wikipedia disambiguation pages weren't handled
- Insufficient title patterns for TV shows
- No fallback when Wikipedia content was too sparse

## The Solution

We've implemented a **4-tier fallback chain**:
1. **Wikipedia** (best quality)
2. **TMDB Overview** (good quality)  
3. **TMDB Inference** (inferred from genres/keywords)
4. **Conservative Defaults** (genre-based fallback)

## How to Use

### Step 1: Test on a Single Title

Pick one of the problematic titles and test:

```bash
# Test on "The Walking Dead" (id: 1402) - missing vibes/tone
node run-enrichment.js --id 1402
```

**Expected output:**
- Tries Wikipedia patterns for TV show
- Falls back to TMDB if needed
- Shows which tier succeeded
- Displays final vibes, tone, pacing, themes

### Step 2: Preview What Will Be Re-Enriched

```bash
# Dry run to see all titles with missing data
npm run re-enrich:dry-run
```

This shows you:
- How many titles need re-enrichment
- Sample of titles (first 10)
- What data they're missing (vibes, tone, or both)

### Step 3: Re-Enrich in Small Batches (Recommended)

Start with a small batch to verify everything works:

```bash
# Re-enrich first 10 titles
node re-enrich-missing.js --limit 10
```

**Watch for:**
- Method distribution (Wikipedia vs TMDB vs defaults)
- Success rate (should be ~100% now)
- Quality of generated metadata

### Step 4: Re-Enrich All Missing Data

Once you're confident it's working:

```bash
# Re-enrich ALL titles with missing vibes/tone
npm run re-enrich
```

This will:
- Process all 103 titles with missing data
- Wait 5 seconds before starting (Ctrl+C to cancel)
- Use 1.5s delay between titles (rate limiting)
- Show final statistics and method breakdown

**Expected duration:** ~3-5 minutes for 103 titles

### Step 5: Verify Results

Check the database to see improvements:

```sql
-- Before: 103 titles missing vibes/tone (51.5%)
-- After: Should be <10 missing (target <5%)

SELECT 
  COUNT(*) as total_titles,
  COUNT(vibes) as has_vibes,
  COUNT(tone) as has_tone,
  ROUND(100.0 * COUNT(vibes) / COUNT(*), 2) as vibes_coverage_pct,
  ROUND(100.0 * COUNT(tone) / COUNT(*), 2) as tone_coverage_pct
FROM titles;
```

## Additional Commands

### Re-enrich by Content Type

```bash
# Re-enrich only movies with missing data
npm run re-enrich:movies

# Re-enrich only TV shows with missing data
npm run re-enrich:tv
```

### Re-enrich Specific Titles

```bash
# Single title by ID
node re-enrich-missing.js --id 1402

# Multiple specific titles (run command multiple times)
node re-enrich-missing.js --id 1405  # Dexter
node re-enrich-missing.js --id 1408  # House
```

### Force Re-enrichment (All Titles)

Use this to test the new pipeline on ALL titles (even those with existing data):

```bash
# CAUTION: This overwrites ALL metadata
node re-enrich-missing.js --force --limit 5  # Test on 5 first
```

## Troubleshooting

### "No titles need re-enrichment"

This means all titles already have vibes AND tone. Options:
- Use `--force` to re-enrich anyway
- Use `--id <ID>` to target a specific title
- Check database to confirm data is actually missing

### Low Wikipedia success rate

If most titles are falling back to TMDB inference or defaults:
- Check your Wikipedia API access (should be open, no auth needed)
- Verify network connectivity
- Check logs for 404 errors vs disambiguation skips

### Generic vibes (just genre names)

If you're getting vibes like "action", "drama" (not "high-octane action"):
- LLM quality validation might be too lenient
- Check `isMetadataHighQuality()` function
- May need to adjust prompts in `llm-extractor.js`

### OpenAI API rate limits

If you hit rate limits:
- Increase `delayMs` in `re-enrich-missing.js` (default: 1500ms)
- Run in smaller batches with `--limit`
- Check your OpenAI tier/quota

## Success Metrics

After re-enrichment, you should see:

✅ **Coverage:**
- Vibes: >90% (target: >95%)
- Tone: >90% (target: >95%)

✅ **Method Distribution:**
- Wikipedia: 30-50% (varies by title obscurity)
- TMDB Overview: 20-30%
- TMDB Inference: 15-25%
- Defaults: <20% (mostly obscure titles)

✅ **Data Quality:**
- <5% generic vibes (just genre names)
- Average 2-4 vibes per title
- All titles have tone and pacing

## Next Steps After Re-Enrichment

1. **Regenerate embeddings** for titles with changed metadata:
   ```bash
   npm run backfill:multi:incremental
   ```

2. **Test search quality** to see if vibes improve recommendations:
   ```bash
   npm run search:multi
   ```

3. **Monitor for new titles** - future ingests will use the improved pipeline automatically

## Questions?

- Check `ENRICHMENT_IMPROVEMENTS.md` for technical details
- Review code comments in:
  - `wikipedia-fetcher.js` - Wikipedia patterns
  - `llm-extractor.js` - TMDB inference logic
  - `enrich-titles.js` - 4-tier fallback chain
  - `conservative-defaults.js` - Genre mappings
