-- ============================================================
-- PHASE 3: DEDUPLICATION & VALIDATION
-- ============================================================
-- Handle duplicate titles and set up validation rules
-- for maintaining data quality at scale (10k-100k records)
-- ============================================================

-- ============================================================
-- 1. IDENTIFY ALL DUPLICATE TITLES
-- ============================================================
-- 6 duplicate title groups found (12 total records)

CREATE TEMP TABLE IF NOT EXISTS duplicate_titles AS
SELECT
  title,
  kind,
  COUNT(*) as duplicate_count,
  array_agg(id ORDER BY id) as ids,
  array_agg(release_date ORDER BY id) as release_dates,
  array_agg(imdb_id ORDER BY id) as imdb_ids,
  array_agg(popularity ORDER BY id DESC) as popularities,
  array_agg(vote_count ORDER BY id DESC) as vote_counts
FROM titles
GROUP BY title, kind
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

SELECT * FROM duplicate_titles;

-- Detailed view of duplicates
SELECT
  t.id,
  t.title,
  t.kind,
  t.imdb_id,
  t.release_date,
  t.original_title,
  t.popularity,
  t.vote_count,
  t.vote_average,
  t.overview,
  t.profile_string
FROM titles t
WHERE EXISTS (
  SELECT 1 FROM duplicate_titles dt
  WHERE t.title = dt.title AND t.kind = dt.kind
)
ORDER BY t.title, t.release_date NULLS LAST;


-- ============================================================
-- 2. DEDUPLICATION STRATEGY
-- ============================================================
-- For each duplicate group, determine which record to keep

CREATE TEMP TABLE IF NOT EXISTS deduplication_decisions AS
WITH duplicate_details AS (
  SELECT
    t.id,
    t.title,
    t.kind,
    t.imdb_id,
    t.release_date,
    t.original_title,
    t.popularity,
    t.vote_count,
    t.vote_average,
    -- Quality score for choosing which duplicate to keep
    (
      (CASE WHEN t.overview IS NOT NULL AND length(t.overview) > 100 THEN 2 ELSE 0 END) +
      (CASE WHEN t.keywords IS NOT NULL AND array_length(t.keywords, 1) >= 5 THEN 2 ELSE 0 END) +
      (CASE WHEN t.themes IS NOT NULL AND array_length(t.themes, 1) >= 3 THEN 2 ELSE 0 END) +
      (CASE WHEN t.director IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN t."cast" IS NOT NULL AND jsonb_array_length(t."cast") > 0 THEN 1 ELSE 0 END) +
      (CASE WHEN t.imdb_id IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN t.vote_count > 100 THEN 1 ELSE 0 END)
    ) as quality_score,
    -- Rank within duplicate group
    ROW_NUMBER() OVER (
      PARTITION BY t.title, t.kind
      ORDER BY
        t.popularity DESC NULLS LAST,
        t.vote_count DESC NULLS LAST,
        (CASE WHEN t.imdb_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
        t.id ASC
    ) as rank_in_group
  FROM titles t
  WHERE EXISTS (
    SELECT 1 FROM duplicate_titles dt
    WHERE t.title = dt.title AND t.kind = dt.kind
  )
)
SELECT
  id,
  title,
  kind,
  imdb_id,
  release_date,
  popularity,
  quality_score,
  rank_in_group,
  CASE WHEN rank_in_group = 1 THEN 'KEEP' ELSE 'DELETE' END as action,
  CASE
    WHEN rank_in_group = 1 THEN 'Keep: Highest popularity/quality'
    ELSE 'Delete: Lower quality duplicate'
  END as reason
FROM duplicate_details
ORDER BY title, rank_in_group;

SELECT * FROM deduplication_decisions;


-- ============================================================
-- 3. REVIEW DEDUPLICATION DECISIONS
-- ============================================================
-- MANUAL REVIEW REQUIRED: Verify these decisions before deletion

-- Big Brother (TV): Keep id=10160 or 11366?
SELECT * FROM deduplication_decisions WHERE title = 'Big Brother';

-- Doctor Who (TV): Keep id=121 or 57243?
SELECT * FROM deduplication_decisions WHERE title = 'Doctor Who';

-- Doraemon (TV): Keep id=65733 or 57911?
SELECT * FROM deduplication_decisions WHERE title = 'Doraemon';

-- How to Train Your Dragon (Movie): Keep id=10191 or 1087192?
SELECT * FROM deduplication_decisions WHERE title = 'How to Train Your Dragon';

-- Mantis (Movie): Keep id=1267319 or 1498658?
SELECT * FROM deduplication_decisions WHERE title = 'Mantis';

-- Scream (Movie): Keep id=4232 or 646385?
SELECT * FROM deduplication_decisions WHERE title = 'Scream';


-- ============================================================
-- 4. EXECUTE DEDUPLICATION (CAREFUL!)
-- ============================================================
-- ⚠️ ONLY RUN AFTER MANUAL VERIFICATION ⚠️
-- This will permanently delete duplicate records

/*
-- Dry run: See what would be deleted
SELECT id, title, kind, imdb_id, popularity, 'WOULD BE DELETED' as status
FROM deduplication_decisions
WHERE action = 'DELETE';

-- Actual deletion (UNCOMMENT ONLY AFTER VERIFICATION)
-- DELETE FROM titles
-- WHERE id IN (
--   SELECT id
--   FROM deduplication_decisions
--   WHERE action = 'DELETE'
-- );
*/


-- ============================================================
-- 5. ALTERNATIVE: DISAMBIGUATE INSTEAD OF DELETE
-- ============================================================
-- Option: Keep both records but add disambiguation to title

-- Example: "Doctor Who (1963)" vs "Doctor Who (2005)"
-- Example: "Scream (1996)" vs "Scream (2022)"

CREATE TEMP TABLE IF NOT EXISTS disambiguation_strategy AS
SELECT
  t.id,
  t.title,
  t.kind,
  t.release_date,
  t.imdb_id,
  -- Suggested disambiguated title
  CASE
    WHEN t.release_date IS NOT NULL THEN
      t.title || ' (' || EXTRACT(YEAR FROM t.release_date) || ')'
    WHEN t.original_title IS NOT NULL AND t.original_title != t.title THEN
      t.title || ' (' || t.original_title || ')'
    ELSE
      t.title || ' (ID: ' || t.id || ')'
  END as suggested_disambiguated_title
FROM titles t
WHERE EXISTS (
  SELECT 1 FROM duplicate_titles dt
  WHERE t.title = dt.title AND t.kind = dt.kind
)
ORDER BY t.title, t.release_date;

SELECT * FROM disambiguation_strategy;

-- Apply disambiguation (if preferred over deletion)
/*
UPDATE titles t
SET title = ds.suggested_disambiguated_title
FROM disambiguation_strategy ds
WHERE t.id = ds.id;
*/


-- ============================================================
-- 6. MISSING IMDB IDs (29 records)
-- ============================================================
CREATE TEMP TABLE IF NOT EXISTS needs_imdb_id AS
SELECT
  id,
  title,
  kind,
  release_date,
  popularity,
  original_title,
  -- Use TMDB API to get IMDB ID
  CASE
    WHEN kind = 'movie' THEN 'TMDB API: /movie/{id}/external_ids'
    WHEN kind = 'tv' THEN 'TMDB API: /tv/{id}/external_ids'
  END as data_source
FROM titles
WHERE imdb_id IS NULL OR trim(imdb_id) = ''
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM needs_imdb_id;

-- High priority titles missing IMDB ID
SELECT * FROM needs_imdb_id WHERE popularity > 10 LIMIT 20;


-- ============================================================
-- 7. DATA QUALITY VALIDATION RULES
-- ============================================================
-- Create functions/triggers to maintain quality standards

-- Rule 1: Ensure minimum theme count for new records
CREATE OR REPLACE FUNCTION validate_theme_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.themes IS NOT NULL AND array_length(NEW.themes, 1) < 2 THEN
    RAISE WARNING 'Title "%" has only % theme(s). Recommend 3+ themes for quality embeddings.',
      NEW.title, array_length(NEW.themes, 1);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CREATE TRIGGER check_theme_quality
-- BEFORE INSERT OR UPDATE ON titles
-- FOR EACH ROW
-- EXECUTE FUNCTION validate_theme_count();


-- Rule 2: Ensure minimum vibe count
CREATE OR REPLACE FUNCTION validate_vibe_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.vibes IS NOT NULL AND array_length(NEW.vibes, 1) < 3 THEN
    RAISE WARNING 'Title "%" has only % vibe(s). Recommend 3+ vibes for quality embeddings.',
      NEW.title, array_length(NEW.vibes, 1);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CREATE TRIGGER check_vibe_quality
-- BEFORE INSERT OR UPDATE ON titles
-- FOR EACH ROW
-- EXECUTE FUNCTION validate_vibe_count();


-- Rule 3: Ensure overview is sufficiently detailed
CREATE OR REPLACE FUNCTION validate_overview_length()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.overview IS NOT NULL AND length(NEW.overview) < 100 THEN
    RAISE WARNING 'Title "%" has short overview (% chars). Recommend 150+ chars for quality embeddings.',
      NEW.title, length(NEW.overview);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CREATE TRIGGER check_overview_quality
-- BEFORE INSERT OR UPDATE ON titles
-- FOR EACH ROW
-- EXECUTE FUNCTION validate_overview_length();


-- Rule 4: Prevent duplicate title+kind combinations
CREATE OR REPLACE FUNCTION prevent_duplicate_titles()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM titles
    WHERE title = NEW.title
    AND kind = NEW.kind
    AND id != NEW.id
  ) THEN
    RAISE EXCEPTION 'Duplicate title detected: "%" (%). Consider disambiguation.', NEW.title, NEW.kind;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CREATE TRIGGER prevent_duplicates
-- BEFORE INSERT OR UPDATE ON titles
-- FOR EACH ROW
-- EXECUTE FUNCTION prevent_duplicate_titles();


-- Rule 5: Ensure embeddings are regenerated when source data changes
CREATE OR REPLACE FUNCTION flag_embedding_regeneration()
RETURNS TRIGGER AS $$
BEGIN
  -- If key fields for embeddings change, flag for regeneration
  IF (
    OLD.overview IS DISTINCT FROM NEW.overview OR
    OLD.profile_string IS DISTINCT FROM NEW.profile_string OR
    OLD.themes IS DISTINCT FROM NEW.themes OR
    OLD.vibes IS DISTINCT FROM NEW.vibes OR
    OLD.keywords IS DISTINCT FROM NEW.keywords OR
    OLD.tone IS DISTINCT FROM NEW.tone OR
    OLD.pacing IS DISTINCT FROM NEW.pacing
  ) THEN
    -- Add a flag or queue for embedding regeneration
    -- This requires adding a column: needs_embedding_update BOOLEAN
    -- NEW.needs_embedding_update = TRUE;
    RAISE NOTICE 'Title "%" has changed. Embeddings should be regenerated.', NEW.title;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CREATE TRIGGER flag_embedding_update
-- BEFORE UPDATE ON titles
-- FOR EACH ROW
-- EXECUTE FUNCTION flag_embedding_regeneration();


-- ============================================================
-- 8. CREATE QUALITY INDEXES FOR BETTER PERFORMANCE
-- ============================================================
-- Add indexes on frequently queried quality-related fields

-- Index for finding records needing keyword backfill
CREATE INDEX IF NOT EXISTS idx_titles_missing_keywords
ON titles (id)
WHERE keywords IS NULL OR array_length(keywords, 1) IS NULL;

-- Index for finding records needing theme backfill
CREATE INDEX IF NOT EXISTS idx_titles_missing_themes
ON titles (id)
WHERE themes IS NULL OR array_length(themes, 1) IS NULL;

-- Index for finding low-quality vibes
CREATE INDEX IF NOT EXISTS idx_titles_low_vibe_count
ON titles (id)
WHERE vibes IS NOT NULL AND array_length(vibes, 1) <= 2;

-- Index on popularity for prioritization
CREATE INDEX IF NOT EXISTS idx_titles_popularity
ON titles (popularity DESC NULLS LAST);

-- Index on IMDB ID for lookups
CREATE INDEX IF NOT EXISTS idx_titles_imdb_id
ON titles (imdb_id)
WHERE imdb_id IS NOT NULL;

-- GIN indexes for array searches
CREATE INDEX IF NOT EXISTS idx_titles_keywords_gin
ON titles USING GIN (keywords);

CREATE INDEX IF NOT EXISTS idx_titles_themes_gin
ON titles USING GIN (themes);

CREATE INDEX IF NOT EXISTS idx_titles_genres_gin
ON titles USING GIN (genres);


-- ============================================================
-- 9. CREATE MATERIALIZED VIEW FOR QUALITY DASHBOARD
-- ============================================================
-- Fast-access summary of data quality metrics

CREATE MATERIALIZED VIEW IF NOT EXISTS data_quality_dashboard AS
SELECT
  -- Overall statistics
  COUNT(*) as total_titles,
  COUNT(DISTINCT kind) as title_types,

  -- Embedding completeness
  COUNT(content_embedding) as has_content_embedding,
  COUNT(vibe_embedding) as has_vibe_embedding,
  COUNT(metadata_embedding) as has_metadata_embedding,

  -- Content quality
  COUNT(CASE WHEN keywords IS NOT NULL AND array_length(keywords, 1) >= 5 THEN 1 END) as good_keywords,
  COUNT(CASE WHEN themes IS NOT NULL AND array_length(themes, 1) >= 3 THEN 1 END) as good_themes,
  COUNT(CASE WHEN vibes IS NOT NULL AND array_length(vibes, 1) >= 3 THEN 1 END) as good_vibes,
  COUNT(CASE WHEN overview IS NOT NULL AND length(overview) >= 100 THEN 1 END) as good_overview,
  COUNT(CASE WHEN profile_string IS NOT NULL AND length(profile_string) >= 100 THEN 1 END) as good_profile,

  -- Metadata completeness
  COUNT(director) as has_director,
  COUNT(CASE WHEN "cast" IS NOT NULL AND jsonb_array_length("cast") > 0 THEN 1 END) as has_cast,
  COUNT(certification) as has_certification,
  COUNT(imdb_id) as has_imdb_id,

  -- Quality scores
  ROUND(AVG(CASE
    WHEN keywords IS NOT NULL AND array_length(keywords, 1) >= 5 THEN 1 ELSE 0 END
  ) * 100, 2) as pct_good_keywords,
  ROUND(AVG(CASE
    WHEN themes IS NOT NULL AND array_length(themes, 1) >= 3 THEN 1 ELSE 0 END
  ) * 100, 2) as pct_good_themes,

  -- Timestamp
  NOW() as last_updated
FROM titles;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_data_quality_dashboard_refresh
ON data_quality_dashboard (last_updated);

-- Refresh command (run periodically)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY data_quality_dashboard;

SELECT * FROM data_quality_dashboard;


-- ============================================================
-- 10. FINAL VALIDATION CHECKLIST
-- ============================================================
-- Run these queries after completing all cleanup phases

-- Check 1: No records with null embeddings
SELECT
  'NULL EMBEDDINGS CHECK' as validation_check,
  COUNT(*) as failing_records,
  CASE WHEN COUNT(*) = 0 THEN '✓ PASS' ELSE '✗ FAIL' END as status
FROM titles
WHERE content_embedding IS NULL
   OR vibe_embedding IS NULL
   OR metadata_embedding IS NULL;

-- Check 2: All records have minimum keyword count
SELECT
  'KEYWORD COMPLETENESS CHECK' as validation_check,
  COUNT(*) as failing_records,
  CASE WHEN COUNT(*) < 50 THEN '✓ PASS' ELSE '✗ FAIL' END as status
FROM titles
WHERE keywords IS NULL OR array_length(keywords, 1) < 3;

-- Check 3: All records have minimum theme count
SELECT
  'THEME COMPLETENESS CHECK' as validation_check,
  COUNT(*) as failing_records,
  CASE WHEN COUNT(*) < 25 THEN '✓ PASS' ELSE '✗ FAIL' END as status
FROM titles
WHERE themes IS NULL OR array_length(themes, 1) < 2;

-- Check 4: All records have quality overview
SELECT
  'OVERVIEW QUALITY CHECK' as validation_check,
  COUNT(*) as failing_records,
  CASE WHEN COUNT(*) < 10 THEN '✓ PASS' ELSE '✗ FAIL' END as status
FROM titles
WHERE overview IS NULL OR length(overview) < 80;

-- Check 5: No duplicate titles remain
SELECT
  'DUPLICATE TITLES CHECK' as validation_check,
  COUNT(*) as duplicate_groups,
  CASE WHEN COUNT(*) = 0 THEN '✓ PASS' ELSE '✗ FAIL' END as status
FROM (
  SELECT title, kind, COUNT(*) as cnt
  FROM titles
  GROUP BY title, kind
  HAVING COUNT(*) > 1
) dup;

-- Check 6: High-popularity titles have IMDB IDs
SELECT
  'IMDB ID CHECK (Popular Titles)' as validation_check,
  COUNT(*) as failing_records,
  CASE WHEN COUNT(*) < 5 THEN '✓ PASS' ELSE '✗ FAIL' END as status
FROM titles
WHERE (imdb_id IS NULL OR trim(imdb_id) = '')
  AND popularity > 20;

-- Check 7: Vector dimensions are consistent
SELECT
  'VECTOR DIMENSION CHECK' as validation_check,
  COUNT(*) as failing_records,
  CASE WHEN COUNT(*) = 0 THEN '✓ PASS' ELSE '✗ FAIL' END as status
FROM titles
WHERE vector_dims(content_embedding) != 1536
   OR vector_dims(vibe_embedding) != 1536
   OR vector_dims(metadata_embedding) != 1536;

-- Consolidated validation report
SELECT
  '=== DATA QUALITY VALIDATION REPORT ===' as report_title,
  (SELECT COUNT(*) FROM titles) as total_records,
  (SELECT COUNT(*) FROM titles WHERE
    keywords IS NOT NULL AND array_length(keywords, 1) >= 5 AND
    themes IS NOT NULL AND array_length(themes, 1) >= 3 AND
    vibes IS NOT NULL AND array_length(vibes, 1) >= 3 AND
    overview IS NOT NULL AND length(overview) >= 100 AND
    content_embedding IS NOT NULL AND
    vibe_embedding IS NOT NULL AND
    metadata_embedding IS NOT NULL
  ) as high_quality_records,
  ROUND(
    (SELECT COUNT(*) FROM titles WHERE
      keywords IS NOT NULL AND array_length(keywords, 1) >= 5 AND
      themes IS NOT NULL AND array_length(themes, 1) >= 3 AND
      vibes IS NOT NULL AND array_length(vibes, 1) >= 3 AND
      overview IS NOT NULL AND length(overview) >= 100 AND
      content_embedding IS NOT NULL AND
      vibe_embedding IS NOT NULL AND
      metadata_embedding IS NOT NULL
    )::NUMERIC * 100 / (SELECT COUNT(*) FROM titles),
    2
  ) as pct_high_quality,
  NOW() as validated_at;


-- ============================================================
-- NOTES FOR EXECUTION
-- ============================================================
/*
PHASE 3: DEDUPLICATION & VALIDATION WORKFLOW

1. Review duplicate titles and decide keep/delete strategy
2. Either delete duplicates OR disambiguate titles with years
3. Backfill missing IMDB IDs for traceability
4. Enable validation triggers to prevent future quality issues
5. Create quality indexes for performance at scale
6. Set up materialized view for ongoing quality monitoring
7. Run validation checklist after all cleanup phases

SCALING CONSIDERATIONS (10k-100k records):
- Keep validation triggers active to catch issues early
- Refresh materialized view daily/weekly for monitoring
- Use partial indexes to reduce index size
- Consider partitioning by kind (movie/tv) if needed
- Monitor embedding generation performance
- Set up automated quality reporting

AFTER CLEANUP:
✓ Regenerate embeddings for all modified records
✓ Validate vector search quality improvements
✓ Benchmark query performance
✓ Document quality standards for future data ingestion
*/
