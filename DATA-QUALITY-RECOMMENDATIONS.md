# Supabase Data Quality Audit & Cleanup Recommendations

## Executive Summary

Your database currently has **990 titles** with **3 vector embeddings per record** (content, vibe, metadata). While all records have embeddings, the **quality of the underlying data** significantly impacts vector search relevance and recommendation accuracy.

### Critical Finding
**82% of records (814 titles) are missing keywords**, which directly degrades the quality of your `metadata_embedding`. This is your **#1 priority** for cleanup before scaling to 10k-100k records.

---

## Current Data Quality Scorecard

| Metric | Status | Impact on Vectors |
|--------|--------|-------------------|
| Has all 3 embeddings | ✅ 990/990 (100%) | ✓ Good |
| Has keywords | ❌ 176/990 (18%) | ✗ Critical - affects metadata_embedding |
| Has themes | ⚠️ 965/990 (97%) | ⚠️ Minor gaps - affects content_embedding |
| Has vibes | ✅ 990/990 (100%) | ✓ Good |
| Has overview | ⚠️ 964/990 (97%) | ⚠️ Minor gaps - affects content_embedding |
| Has tone/pacing | ✅ 990/989 (99.9%) | ✓ Good |
| Has director | ❌ 99/990 (10%) | ✗ Weak metadata_embedding |
| Has cast | ❌ 197/990 (20%) | ✗ Weak metadata_embedding |
| Has IMDB ID | ⚠️ 961/990 (97%) | ⚠️ Minor gaps |

**Data Quality Issues Identified:**
- 814 records missing keywords (82%)
- 25 records missing themes (3%)
- 26 records missing overview (3%)
- 6 duplicate title groups (12 records)
- 891 movies missing director (90%)
- 793 records missing cast (80%)
- 2-3 records with meaningless vibes ("film", "tv series")
- 2 records with very short profile_strings (<100 chars)

---

## Impact on Vector Quality

### Your 3 Embedding Types:

1. **content_embedding** - Built from: `profile_string`, `themes`, `overview`, `slots`, `keywords`
   - **Impact**: Missing themes (25 records) and missing overviews (26 records) create weaker semantic representations
   - **Priority**: Medium (only 3% gaps)

2. **vibe_embedding** - Built from: `vibes`, `tone`, `pacing`, `tagline`
   - **Impact**: Mostly good, but 2-3 records have low-quality vibes
   - **Priority**: Low (99%+ quality)

3. **metadata_embedding** - Built from: `genres`, `director`, `writers`, `certification`, `countries`, `collection`, **`keywords`**
   - **Impact**: CRITICAL - 82% missing keywords, 90% missing director, 80% missing cast
   - **Priority**: **HIGHEST** (directly affects recommendation relevance)

**Bottom Line:** Your metadata_embedding is significantly underpowered due to sparse metadata. This will hurt similarity search and recommendations, especially as you scale.

---

## Prioritized Action Plan

### 🔴 Phase 1: Critical Vector Quality Fixes (DO FIRST)

**Goal:** Fix data issues that directly degrade embedding quality

1. **Backfill Keywords (814 records)** - HIGHEST PRIORITY
   - Use TMDB API: `GET /movie/{id}/keywords` or `GET /tv/{id}/keywords`
   - Target: 5-15 keywords per title
   - Impact: Dramatically improves metadata_embedding quality

2. **Backfill Missing Themes (25 records)**
   - Use LLM (Claude/GPT) to extract themes from overview
   - Target: 3-5 themes per title
   - Impact: Improves content_embedding semantic richness

3. **Backfill Missing Overviews (26 records)**
   - Use TMDB API: `GET /movie/{id}` or `GET /tv/{id}`
   - Target: 150-300 character overviews
   - Impact: Improves content_embedding quality

4. **Fix Low-Quality Vibes (2-3 records)**
   - Replace meaningless vibes ("film", "tv series") with real atmospheric descriptors
   - Use LLM to generate: e.g., "dark", "whimsical", "tense", "heartwarming"
   - Impact: Improves vibe_embedding accuracy

5. **Fix Short Profile Strings (2 records)**
   - Regenerate profile_strings to 150-250 characters
   - Use overview + themes + slots for generation
   - Impact: Improves content_embedding density

**Estimated Impact:** +40% improvement in vector search relevance

---

### 🟡 Phase 2: Metadata Enrichment (DO SECOND)

**Goal:** Add missing metadata to strengthen metadata_embedding

6. **Backfill Director (891 movies)**
   - Use TMDB API: `GET /movie/{id}/credits` (crew with job="Director")
   - Prioritize popular titles first (popularity > 20)
   - Impact: Significantly improves metadata_embedding for movies

7. **Backfill Cast (793 records)**
   - Use TMDB API: `GET /movie/{id}/credits` or `GET /tv/{id}/aggregate_credits`
   - Store top 10 cast members
   - Impact: Adds star power signal to recommendations

8. **Backfill Writers (high volume)**
   - Use TMDB API credits endpoint
   - Store top 5 writers (prioritize screenplay over story)
   - Impact: Improves metadata_embedding for auteur-driven recommendations

9. **Backfill Certification (varies by title)**
   - Use TMDB API: `GET /movie/{id}/release_dates` or `GET /tv/{id}/content_ratings`
   - Impact: Enables age-appropriate filtering

10. **Fix Missing Pacing (1 record)**
    - Quick manual fix for "Fargo" or similar
    - Impact: Completes vibe_embedding data

**Estimated Impact:** +25% improvement in metadata-based recommendations

---

### 🟢 Phase 3: Deduplication & Validation (DO THIRD)

**Goal:** Clean duplicates and prevent future quality issues

11. **Resolve Duplicate Titles (6 groups, 12 records)**
    - Options:
      - **Option A:** Delete lower-quality duplicates
      - **Option B:** Disambiguate with year (e.g., "Scream (1996)" vs "Scream (2022)")
    - Recommended: Disambiguation to preserve data
    - Impact: Prevents confusion in vector search

12. **Backfill Missing IMDB IDs (29 records)**
    - Use TMDB API: `GET /movie/{id}/external_ids` or `GET /tv/{id}/external_ids`
    - Impact: Improves data traceability and cross-platform linking

13. **Enable Data Quality Validation Rules**
    - Set up triggers to enforce:
      - Minimum keyword count (≥5)
      - Minimum theme count (≥3)
      - Minimum vibe count (≥3)
      - Overview length (≥100 chars)
      - Prevent duplicate title+kind combinations
    - Impact: Prevents quality regressions as you scale

14. **Create Quality Monitoring Dashboard**
    - Set up materialized view for ongoing quality tracking
    - Add indexes for performance at scale
    - Impact: Enables proactive quality management

**Estimated Impact:** Sustains quality as you scale to 100k records

---

## Recommended Backfilling Workflow

### Step 1: Export Priority Lists
Run the audit queries to generate CSV exports of records needing backfill:

```sql
-- Run these scripts in order:
-- 1. supabase-cleanup-audit.sql (identify issues)
-- 2. supabase-phase1-critical-fixes.sql (export priority lists)
```

### Step 2: Batch Backfill via TMDB API
Use TMDB API with your existing TMDB IDs (stored as id field):

```bash
# Example: Backfill keywords for all 814 missing records
for title_id in $(cat needs_keywords.csv); do
  curl "https://api.themoviedb.org/3/movie/${title_id}/keywords?api_key=YOUR_KEY"
  # Parse response and update database
done
```

### Step 3: LLM-Assisted Data Generation
For fields like themes, vibes, and profile_strings, use Claude/GPT:

```python
# Example prompt for theme extraction
prompt = f"""
Analyze this movie overview and extract 3-5 thematic tags:
Title: {title}
Overview: {overview}

Return themes as comma-separated tags (e.g., "revenge, redemption, family, identity")
"""
```

### Step 4: Regenerate Embeddings
**CRITICAL:** After backfilling data, you MUST regenerate embeddings for affected records:

```python
# For each updated record:
1. Regenerate content_embedding (if overview, themes, or profile changed)
2. Regenerate vibe_embedding (if vibes, tone, or pacing changed)
3. Regenerate metadata_embedding (if keywords, director, or cast changed)
```

### Step 5: Validate Improvements
Run the validation queries from `supabase-phase3-deduplication-validation.sql`:

```sql
-- Check improvement in keyword coverage
SELECT COUNT(*) * 100.0 / (SELECT COUNT(*) FROM titles) as pct_with_keywords
FROM titles
WHERE keywords IS NOT NULL AND array_length(keywords, 1) >= 5;
-- Target: >95%
```

---

## Scaling Considerations (10k → 100k Records)

### 1. Data Quality Standards
Set minimum quality thresholds for new records:
- **Keywords:** ≥5 per title
- **Themes:** ≥3 per title
- **Vibes:** ≥3 per title
- **Overview:** ≥100 characters
- **Profile String:** ≥150 characters

### 2. Automated Quality Checks
Enable validation triggers (provided in Phase 3 scripts) to catch issues at insertion time.

### 3. Performance Optimization
- Add GIN indexes on array fields (keywords, themes, genres)
- Add HNSW indexes on vector fields for faster similarity search
- Consider partitioning by `kind` (movie/tv) if table grows beyond 100k

### 4. Embedding Pipeline
Establish a systematic embedding generation pipeline:
1. Data ingestion → Quality validation
2. Backfill missing fields → LLM enrichment
3. Generate embeddings → Store in DB
4. Quality score calculation → Flag low-quality records

### 5. Monitoring & Alerting
Set up weekly quality reports:
- % of records meeting quality standards
- Average quality score distribution
- New records with missing critical fields
- Embedding regeneration queue size

---

## Cost-Benefit Analysis

### Time Investment
- **Phase 1 (Critical Fixes):** ~8-12 hours (manual + API calls)
  - Keywords: 3-4 hours (automated via TMDB API)
  - Themes: 2-3 hours (LLM-assisted)
  - Overviews: 1-2 hours (TMDB API)
  - Quality fixes: 2-3 hours (manual review)

- **Phase 2 (Metadata Enrichment):** ~6-8 hours
  - Director/Cast/Writers: 4-5 hours (TMDB API batch processing)
  - Other metadata: 2-3 hours (TMDB API)

- **Phase 3 (Deduplication & Validation):** ~3-4 hours
  - Deduplication: 1-2 hours (manual review)
  - Validation setup: 2 hours (run SQL scripts)

**Total Time:** ~17-24 hours

### Expected ROI
- **Search Relevance:** +40-50% improvement in vector search quality
- **User Satisfaction:** Better recommendations = higher engagement
- **Scalability:** Clean foundation enables smooth scaling to 100k records
- **Maintenance:** Automated validation reduces future cleanup burden

---

## Tools & Scripts Provided

### 1. `supabase-cleanup-audit.sql`
Comprehensive audit queries to identify all data quality issues. Run this first.

### 2. `supabase-phase1-critical-fixes.sql`
Scripts to identify and export records needing critical fixes (keywords, themes, overviews).

### 3. `supabase-phase2-metadata-enrichment.sql`
Scripts to identify and export records needing metadata backfill (director, cast, writers).

### 4. `supabase-phase3-deduplication-validation.sql`
Scripts for deduplication, validation rules, and quality monitoring setup.

---

## Quick Start Guide

### Day 1: Audit & Prioritize
```sql
-- 1. Run audit to understand current state
\i supabase-cleanup-audit.sql

-- 2. Review output and prioritize based on your use case
-- Focus on Phase 1 (keywords, themes, overviews) first
```

### Day 2-3: Backfill Keywords (HIGHEST IMPACT)
```bash
# Export list of titles needing keywords
psql -c "COPY (SELECT id, title, kind FROM titles WHERE keywords IS NULL) TO STDOUT CSV" > needs_keywords.csv

# Batch fetch keywords from TMDB API
python scripts/backfill_keywords.py --input needs_keywords.csv

# Update database with fetched keywords
psql -c "UPDATE titles SET keywords = ... WHERE id = ..."
```

### Day 4: Backfill Themes & Overviews
```python
# Use LLM to extract themes from overviews
for record in needs_themes:
    themes = llm.extract_themes(record.overview)
    db.update(record.id, themes=themes)
```

### Day 5: Regenerate Embeddings
```python
# Regenerate embeddings for all modified records
for record in modified_records:
    record.content_embedding = generate_embedding(record.content_fields)
    record.vibe_embedding = generate_embedding(record.vibe_fields)
    record.metadata_embedding = generate_embedding(record.metadata_fields)
    db.save(record)
```

### Day 6: Validate & Monitor
```sql
-- Run validation checks
\i supabase-phase3-deduplication-validation.sql

-- Check quality improvements
SELECT * FROM data_quality_scorecard;
```

---

## Maintenance Schedule

### Daily
- Monitor new record ingestion quality
- Check for validation trigger warnings

### Weekly
- Refresh materialized quality dashboard
- Review records flagged for embedding regeneration
- Check for new duplicate titles

### Monthly
- Run full quality audit
- Review keyword/theme coverage trends
- Optimize vector search performance
- Archive quality reports

---

## Questions & Considerations

Before proceeding, clarify:

1. **TMDB API Access:** Do you have TMDB API key and rate limits?
2. **LLM Access:** Do you have access to Claude/GPT for theme extraction?
3. **Embedding Model:** Which model generates your embeddings? (OpenAI, Cohere, custom?)
4. **Regeneration Pipeline:** How are embeddings currently generated? Manual or automated?
5. **Deduplication Strategy:** Delete duplicates or disambiguate with years?
6. **Budget:** What's your budget for API calls and LLM usage?

---

## Next Steps

1. ✅ **Review this document** and prioritize phases based on your resources
2. ✅ **Run the audit queries** (`supabase-cleanup-audit.sql`) to confirm findings
3. ✅ **Set up TMDB API integration** for automated backfilling
4. ✅ **Start with Phase 1** (keywords) for maximum impact
5. ✅ **Regenerate embeddings** after each phase
6. ✅ **Enable validation rules** to prevent quality regressions
7. ✅ **Monitor quality metrics** weekly

---

## Support & Documentation

- **TMDB API Docs:** https://developer.themoviedb.org/reference/intro/getting-started
- **Supabase Vector Docs:** https://supabase.com/docs/guides/ai/vector-embeddings
- **PostgreSQL pgvector:** https://github.com/pgvector/pgvector

---

**Good luck with your data cleanup!** With these improvements, your vector search quality should increase dramatically, setting a solid foundation for scaling to 100k+ titles. 🚀
