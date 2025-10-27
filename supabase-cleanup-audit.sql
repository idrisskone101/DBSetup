-- ============================================================
-- SUPABASE DATA QUALITY AUDIT QUERIES
-- ============================================================
-- Run these queries to identify all data quality issues
-- before performing cleanup operations
-- ============================================================

-- ============================================================
-- 1. OVERALL DATA COMPLETENESS SUMMARY
-- ============================================================
SELECT
  'OVERALL SUMMARY' as report_section,
  COUNT(*) as total_titles,
  COUNT(content_embedding) as has_content_emb,
  COUNT(vibe_embedding) as has_vibe_emb,
  COUNT(metadata_embedding) as has_metadata_emb,
  COUNT(overview) as has_overview,
  COUNT(profile_string) as has_profile,
  COUNT(CASE WHEN vibes IS NOT NULL AND array_length(vibes, 1) > 0 THEN 1 END) as has_vibes,
  COUNT(CASE WHEN themes IS NOT NULL AND array_length(themes, 1) > 0 THEN 1 END) as has_themes,
  COUNT(CASE WHEN keywords IS NOT NULL AND array_length(keywords, 1) > 0 THEN 1 END) as has_keywords,
  COUNT(CASE WHEN genres IS NOT NULL AND array_length(genres, 1) > 0 THEN 1 END) as has_genres,
  COUNT(tone) as has_tone,
  COUNT(pacing) as has_pacing,
  COUNT(director) as has_director,
  COUNT(CASE WHEN "cast" IS NOT NULL AND jsonb_array_length("cast") > 0 THEN 1 END) as has_cast,
  COUNT(CASE WHEN slots IS NOT NULL THEN 1 END) as has_slots,
  COUNT(imdb_id) as has_imdb_id
FROM titles;

-- ============================================================
-- 2. CRITICAL ISSUE: MISSING KEYWORDS (Priority 1)
-- ============================================================
-- 82% of records missing keywords - critical for metadata_embedding
SELECT
  'MISSING KEYWORDS' as issue,
  COUNT(*) as affected_records,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM titles), 2) as percentage
FROM titles
WHERE keywords IS NULL OR array_length(keywords, 1) IS NULL;

-- Get sample of records missing keywords
SELECT id, title, kind, imdb_id, genres, themes
FROM titles
WHERE keywords IS NULL OR array_length(keywords, 1) IS NULL
ORDER BY popularity DESC NULLS LAST
LIMIT 20;

-- ============================================================
-- 3. CRITICAL ISSUE: MISSING THEMES (Priority 2)
-- ============================================================
SELECT
  'MISSING THEMES' as issue,
  COUNT(*) as affected_records
FROM titles
WHERE themes IS NULL OR array_length(themes, 1) IS NULL;

-- Get records missing themes with their other data
SELECT id, title, kind, overview, vibes, tone, pacing, genres
FROM titles
WHERE themes IS NULL OR array_length(themes, 1) IS NULL
LIMIT 25;

-- ============================================================
-- 4. CRITICAL ISSUE: LOW-QUALITY VIBES (Priority 3)
-- ============================================================
-- Vibes that are just "film" or "tv series" are meaningless
SELECT
  'LOW-QUALITY VIBES' as issue,
  id, title, kind, vibes, themes, tone
FROM titles
WHERE
  vibes @> ARRAY['film']::text[]
  OR vibes @> ARRAY['tv series']::text[]
  OR (vibes IS NOT NULL AND array_length(vibes, 1) = 1);

-- ============================================================
-- 5. MISSING OVERVIEWS (Priority 4)
-- ============================================================
SELECT
  'MISSING OVERVIEW' as issue,
  COUNT(*) as affected_records
FROM titles
WHERE overview IS NULL OR trim(overview) = '';

-- Get list of titles missing overview
SELECT id, title, kind, imdb_id, profile_string, release_date
FROM titles
WHERE overview IS NULL OR trim(overview) = ''
ORDER BY popularity DESC NULLS LAST;

-- ============================================================
-- 6. SHORT/LOW-QUALITY PROFILE STRINGS
-- ============================================================
-- Profile strings under 100 chars are likely too terse for quality embeddings
SELECT
  'SHORT PROFILE STRINGS' as issue,
  id, title, kind, profile_string, length(profile_string) as char_length
FROM titles
WHERE profile_string IS NOT NULL AND length(profile_string) < 100
ORDER BY length(profile_string);

-- ============================================================
-- 7. INSUFFICIENT THEMATIC RICHNESS
-- ============================================================
-- Records with only 1-2 themes may lack semantic depth
SELECT
  'INSUFFICIENT THEMES' as issue,
  COUNT(*) as affected_records
FROM titles
WHERE themes IS NOT NULL AND array_length(themes, 1) <= 2;

-- Sample of records with insufficient themes
SELECT id, title, kind, themes, vibes, overview
FROM titles
WHERE themes IS NOT NULL AND array_length(themes, 1) <= 2
ORDER BY RANDOM()
LIMIT 20;

-- ============================================================
-- 8. DUPLICATE TITLES
-- ============================================================
SELECT
  'DUPLICATE TITLES' as issue,
  title,
  kind,
  COUNT(*) as duplicate_count,
  array_agg(id ORDER BY id) as ids,
  array_agg(release_date ORDER BY id) as release_dates,
  array_agg(imdb_id ORDER BY id) as imdb_ids
FROM titles
GROUP BY title, kind
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- ============================================================
-- 9. MISSING IMDB IDs
-- ============================================================
SELECT
  'MISSING IMDB_ID' as issue,
  COUNT(*) as affected_records
FROM titles
WHERE imdb_id IS NULL OR trim(imdb_id) = '';

-- List titles missing IMDB IDs (prioritize by popularity)
SELECT id, title, kind, release_date, popularity, vote_average
FROM titles
WHERE imdb_id IS NULL OR trim(imdb_id) = ''
ORDER BY popularity DESC NULLS LAST;

-- ============================================================
-- 10. SPARSE METADATA (DIRECTOR & CAST)
-- ============================================================
SELECT
  'SPARSE METADATA SUMMARY' as report,
  COUNT(*) as total,
  COUNT(director) as has_director,
  COUNT(*) - COUNT(director) as missing_director,
  COUNT(CASE WHEN "cast" IS NOT NULL AND jsonb_array_length("cast") > 0 THEN 1 END) as has_cast,
  COUNT(*) - COUNT(CASE WHEN "cast" IS NOT NULL AND jsonb_array_length("cast") > 0 THEN 1 END) as missing_cast
FROM titles;

-- Movies missing director (directors are more critical for movies)
SELECT id, title, kind, release_date, imdb_id
FROM titles
WHERE kind = 'movie' AND (director IS NULL OR trim(director) = '')
ORDER BY popularity DESC NULLS LAST
LIMIT 30;

-- ============================================================
-- 11. MISSING PACING
-- ============================================================
SELECT id, title, kind, tone, pacing, vibes
FROM titles
WHERE pacing IS NULL OR trim(pacing) = '';

-- ============================================================
-- 12. ARRAY FIELD STATISTICS (for quality benchmarking)
-- ============================================================
SELECT
  'vibes' as field_name,
  ROUND(AVG(array_length(vibes, 1)), 2) as avg_count,
  MIN(array_length(vibes, 1)) as min_count,
  MAX(array_length(vibes, 1)) as max_count,
  COUNT(CASE WHEN array_length(vibes, 1) < 3 THEN 1 END) as below_3_count
FROM titles
WHERE vibes IS NOT NULL AND array_length(vibes, 1) > 0

UNION ALL

SELECT
  'themes' as field_name,
  ROUND(AVG(array_length(themes, 1)), 2) as avg_count,
  MIN(array_length(themes, 1)) as min_count,
  MAX(array_length(themes, 1)) as max_count,
  COUNT(CASE WHEN array_length(themes, 1) < 3 THEN 1 END) as below_3_count
FROM titles
WHERE themes IS NOT NULL AND array_length(themes, 1) > 0

UNION ALL

SELECT
  'keywords' as field_name,
  ROUND(AVG(array_length(keywords, 1)), 2) as avg_count,
  MIN(array_length(keywords, 1)) as min_count,
  MAX(array_length(keywords, 1)) as max_count,
  COUNT(CASE WHEN array_length(keywords, 1) < 5 THEN 1 END) as below_5_count
FROM titles
WHERE keywords IS NOT NULL AND array_length(keywords, 1) > 0;

-- ============================================================
-- 13. TEXT FIELD LENGTH QUALITY CHECK
-- ============================================================
SELECT
  'overview' as field_name,
  ROUND(AVG(length(overview))) as avg_length,
  MIN(length(overview)) as min_length,
  MAX(length(overview)) as max_length,
  COUNT(CASE WHEN length(overview) < 100 THEN 1 END) as too_short_count,
  COUNT(CASE WHEN length(overview) > 1000 THEN 1 END) as too_long_count
FROM titles
WHERE overview IS NOT NULL

UNION ALL

SELECT
  'profile_string' as field_name,
  ROUND(AVG(length(profile_string))) as avg_length,
  MIN(length(profile_string)) as min_length,
  MAX(length(profile_string)) as max_length,
  COUNT(CASE WHEN length(profile_string) < 100 THEN 1 END) as too_short_count,
  COUNT(CASE WHEN length(profile_string) > 300 THEN 1 END) as too_long_count
FROM titles
WHERE profile_string IS NOT NULL;

-- ============================================================
-- 14. VECTOR EMBEDDING VALIDATION
-- ============================================================
-- Ensure all vectors have consistent dimensions
SELECT
  'VECTOR DIMENSIONS' as check_type,
  COUNT(*) as total,
  COUNT(CASE WHEN vector_dims(content_embedding) = 1536 THEN 1 END) as content_correct_dims,
  COUNT(CASE WHEN vector_dims(vibe_embedding) = 1536 THEN 1 END) as vibe_correct_dims,
  COUNT(CASE WHEN vector_dims(metadata_embedding) = 1536 THEN 1 END) as metadata_correct_dims,
  COUNT(CASE WHEN content_embedding IS NULL THEN 1 END) as missing_content_emb,
  COUNT(CASE WHEN vibe_embedding IS NULL THEN 1 END) as missing_vibe_emb,
  COUNT(CASE WHEN metadata_embedding IS NULL THEN 1 END) as missing_metadata_emb
FROM titles;

-- ============================================================
-- 15. PRIORITY CLEANUP LIST (Combined Critical Issues)
-- ============================================================
-- Records with multiple quality issues that need immediate attention
SELECT
  id,
  title,
  kind,
  imdb_id,
  CASE WHEN keywords IS NULL OR array_length(keywords, 1) IS NULL THEN 1 ELSE 0 END as needs_keywords,
  CASE WHEN themes IS NULL OR array_length(themes, 1) IS NULL THEN 1 ELSE 0 END as needs_themes,
  CASE WHEN overview IS NULL OR trim(overview) = '' THEN 1 ELSE 0 END as needs_overview,
  CASE WHEN vibes IS NOT NULL AND array_length(vibes, 1) <= 2 THEN 1 ELSE 0 END as needs_more_vibes,
  CASE WHEN director IS NULL AND kind = 'movie' THEN 1 ELSE 0 END as needs_director,
  CASE WHEN length(profile_string) < 100 THEN 1 ELSE 0 END as needs_better_profile,
  (
    CASE WHEN keywords IS NULL OR array_length(keywords, 1) IS NULL THEN 1 ELSE 0 END +
    CASE WHEN themes IS NULL OR array_length(themes, 1) IS NULL THEN 1 ELSE 0 END +
    CASE WHEN overview IS NULL OR trim(overview) = '' THEN 1 ELSE 0 END +
    CASE WHEN vibes IS NOT NULL AND array_length(vibes, 1) <= 2 THEN 1 ELSE 0 END +
    CASE WHEN director IS NULL AND kind = 'movie' THEN 1 ELSE 0 END +
    CASE WHEN length(profile_string) < 100 THEN 1 ELSE 0 END
  ) as total_issues
FROM titles
WHERE
  (keywords IS NULL OR array_length(keywords, 1) IS NULL)
  OR (themes IS NULL OR array_length(themes, 1) IS NULL)
  OR (overview IS NULL OR trim(overview) = '')
  OR (vibes IS NOT NULL AND array_length(vibes, 1) <= 2)
  OR (director IS NULL AND kind = 'movie')
  OR (length(profile_string) < 100)
ORDER BY total_issues DESC, popularity DESC NULLS LAST
LIMIT 50;
