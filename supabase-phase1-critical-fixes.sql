-- ============================================================
-- PHASE 1: CRITICAL VECTOR QUALITY FIXES
-- ============================================================
-- These fixes directly impact embedding quality and search relevance
-- Execute these BEFORE regenerating embeddings
-- ============================================================

-- ============================================================
-- 1. IDENTIFY RECORDS NEEDING KEYWORD BACKFILL (814 records)
-- ============================================================
-- Export this list to backfill keywords from TMDB API or generate from content
-- Keywords are CRITICAL for metadata_embedding quality

CREATE TEMP TABLE IF NOT EXISTS needs_keywords AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  overview,
  themes,
  genres,
  director,
  popularity,
  -- Suggested approach: Use TMDB API with TMDB ID to fetch keywords
  -- Or generate keywords from: overview + themes + genres
  CONCAT(
    COALESCE(array_to_string(genres, ', '), ''),
    ' | ',
    COALESCE(array_to_string(themes, ', '), '')
  ) as suggested_keyword_source
FROM titles
WHERE keywords IS NULL OR array_length(keywords, 1) IS NULL
ORDER BY popularity DESC NULLS LAST;

-- View the temp table
SELECT * FROM needs_keywords LIMIT 10;

-- Count by kind (movies vs tv shows)
SELECT
  kind,
  COUNT(*) as needs_keywords_count
FROM needs_keywords
GROUP BY kind;

COMMENT ON TABLE needs_keywords IS 'Temporary table of records needing keyword backfill. Use TMDB API or generate from content.';


-- ============================================================
-- 2. IDENTIFY RECORDS NEEDING THEME BACKFILL (25 records)
-- ============================================================
CREATE TEMP TABLE IF NOT EXISTS needs_themes AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  overview,
  vibes,
  tone,
  pacing,
  genres,
  -- Suggested approach: Analyze overview + vibes + tone to generate themes
  -- Or use LLM/Claude to extract themes from overview
  CASE
    WHEN overview IS NOT NULL THEN 'Generate from overview + vibes + genres'
    ELSE 'Needs manual research or TMDB fetch'
  END as suggested_approach
FROM titles
WHERE themes IS NULL OR array_length(themes, 1) IS NULL
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM needs_themes;

COMMENT ON TABLE needs_themes IS 'Temporary table of records missing themes. Extract from overview or fetch from TMDB.';


-- ============================================================
-- 3. FIX LOW-QUALITY VIBES (2-3 records)
-- ============================================================
-- Records with vibes like ["film"] or ["tv series"] are meaningless
-- These need to be replaced with actual atmospheric descriptors

SELECT
  'LOW-QUALITY VIBES TO FIX' as issue_type,
  id,
  title,
  kind,
  vibes,
  themes,
  tone,
  pacing,
  overview
FROM titles
WHERE
  vibes @> ARRAY['film']::text[]
  OR vibes @> ARRAY['tv series']::text[]
  OR (vibes IS NOT NULL AND array_length(vibes, 1) = 1)
ORDER BY id;

-- Example fix for id=800378 (Chikan Densha: OL Kando Kurabe)
-- Current: vibes = ["film"]
-- Should be: vibes = ["erotic", "drama", "provocative", "intimate"]
-- MANUAL FIX REQUIRED - Review each case individually

/*
EXAMPLE UPDATE (DO NOT RUN WITHOUT VERIFICATION):

UPDATE titles
SET vibes = ARRAY['erotic', 'drama', 'provocative', 'intimate']::text[]
WHERE id = 800378;

UPDATE titles
SET vibes = ARRAY['ensemble', 'drama', 'heartwarming']::text[]
WHERE id = 1442544;

UPDATE titles
SET vibes = ARRAY['series', 'dramatic', 'intimate']::text[]
WHERE id = 230318 AND vibes @> ARRAY['tv series']::text[];
*/


-- ============================================================
-- 4. IDENTIFY RECORDS NEEDING OVERVIEW BACKFILL (26 records)
-- ============================================================
CREATE TEMP TABLE IF NOT EXISTS needs_overview AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  profile_string,
  release_date,
  popularity,
  -- Suggested approach: Fetch from TMDB API using TMDB ID
  -- Or scrape from Wikipedia using wiki_source_url
  CASE
    WHEN imdb_id IS NOT NULL THEN 'Fetch from TMDB using IMDB ID'
    WHEN wiki_source_url IS NOT NULL THEN 'Extract from Wikipedia'
    ELSE 'Manual research required'
  END as suggested_source
FROM titles
WHERE overview IS NULL OR trim(overview) = ''
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM needs_overview;

COMMENT ON TABLE needs_overview IS 'Temporary table of records missing overview. Fetch from TMDB or Wikipedia.';


-- ============================================================
-- 5. FIX SHORT/LOW-QUALITY PROFILE STRINGS (2 records)
-- ============================================================
-- Profile strings under 100 chars lack narrative depth for embeddings

SELECT
  'SHORT PROFILE STRINGS' as issue_type,
  id,
  title,
  kind,
  profile_string,
  length(profile_string) as current_length,
  overview,
  themes,
  slots
FROM titles
WHERE profile_string IS NOT NULL AND length(profile_string) < 100
ORDER BY length(profile_string);

-- These need to be regenerated from overview + themes + slots
-- Target length: 150-250 characters for optimal embedding quality

/*
EXAMPLE FIX (regenerate profile_string):

-- For "Your Fault" (id=1156593)
UPDATE titles
SET profile_string = 'A dark romantic drama exploring the complexities of love and relationships as young adults navigate family dynamics, identity crises, and the consequences of their choices in the face of change.'
WHERE id = 1156593;

-- For "Interstellar" (id=157336)
UPDATE titles
SET profile_string = 'A visually stunning science fiction epic where a team of astronauts ventures through a wormhole in search of a new habitable planet, facing impossible odds to ensure humanity''s survival while grappling with time dilation and sacrifice.'
WHERE id = 157336;
*/


-- ============================================================
-- 6. IDENTIFY RECORDS WITH INSUFFICIENT THEMATIC RICHNESS
-- ============================================================
-- Records with only 1-2 themes may produce weak embeddings
-- Ideally aim for 3-5 themes per title

CREATE TEMP TABLE IF NOT EXISTS needs_more_themes AS
SELECT
  id,
  title,
  kind,
  themes,
  array_length(themes, 1) as theme_count,
  vibes,
  overview,
  genres,
  -- Suggest analyzing overview to extract more themes
  'Analyze overview/plot to extract additional themes' as recommendation
FROM titles
WHERE themes IS NOT NULL AND array_length(themes, 1) <= 2
ORDER BY RANDOM()
LIMIT 50;

SELECT * FROM needs_more_themes LIMIT 20;

-- Statistics on theme richness
SELECT
  array_length(themes, 1) as theme_count,
  COUNT(*) as title_count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM titles WHERE themes IS NOT NULL), 2) as percentage
FROM titles
WHERE themes IS NOT NULL
GROUP BY array_length(themes, 1)
ORDER BY theme_count;


-- ============================================================
-- 7. QUALITY VALIDATION CHECKS (Run after fixes)
-- ============================================================

-- Check if critical fields are now populated
CREATE OR REPLACE VIEW data_quality_scorecard AS
SELECT
  id,
  title,
  kind,
  -- Scoring: 1 point for each quality criterion met
  (CASE WHEN keywords IS NOT NULL AND array_length(keywords, 1) >= 5 THEN 1 ELSE 0 END) as has_sufficient_keywords,
  (CASE WHEN themes IS NOT NULL AND array_length(themes, 1) >= 3 THEN 1 ELSE 0 END) as has_sufficient_themes,
  (CASE WHEN vibes IS NOT NULL AND array_length(vibes, 1) >= 3 THEN 1 ELSE 0 END) as has_sufficient_vibes,
  (CASE WHEN overview IS NOT NULL AND length(overview) >= 100 THEN 1 ELSE 0 END) as has_good_overview,
  (CASE WHEN profile_string IS NOT NULL AND length(profile_string) >= 100 THEN 1 ELSE 0 END) as has_good_profile,
  (CASE WHEN content_embedding IS NOT NULL THEN 1 ELSE 0 END) as has_content_embedding,
  (CASE WHEN vibe_embedding IS NOT NULL THEN 1 ELSE 0 END) as has_vibe_embedding,
  (CASE WHEN metadata_embedding IS NOT NULL THEN 1 ELSE 0 END) as has_metadata_embedding,
  -- Total quality score (0-8)
  (
    (CASE WHEN keywords IS NOT NULL AND array_length(keywords, 1) >= 5 THEN 1 ELSE 0 END) +
    (CASE WHEN themes IS NOT NULL AND array_length(themes, 1) >= 3 THEN 1 ELSE 0 END) +
    (CASE WHEN vibes IS NOT NULL AND array_length(vibes, 1) >= 3 THEN 1 ELSE 0 END) +
    (CASE WHEN overview IS NOT NULL AND length(overview) >= 100 THEN 1 ELSE 0 END) +
    (CASE WHEN profile_string IS NOT NULL AND length(profile_string) >= 100 THEN 1 ELSE 0 END) +
    (CASE WHEN content_embedding IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN vibe_embedding IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN metadata_embedding IS NOT NULL THEN 1 ELSE 0 END)
  ) as quality_score
FROM titles;

-- View quality distribution
SELECT
  quality_score,
  COUNT(*) as title_count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM titles), 2) as percentage
FROM data_quality_scorecard
GROUP BY quality_score
ORDER BY quality_score DESC;

-- Titles needing urgent attention (score < 6)
SELECT *
FROM data_quality_scorecard
WHERE quality_score < 6
ORDER BY quality_score ASC, id
LIMIT 30;


-- ============================================================
-- 8. EXPORT LISTS FOR BACKFILLING
-- ============================================================

-- Create a comprehensive backfill priority list
CREATE TEMP TABLE IF NOT EXISTS backfill_priority_list AS
SELECT
  t.id,
  t.title,
  t.kind,
  t.imdb_id,
  t.popularity,
  CASE WHEN t.keywords IS NULL OR array_length(t.keywords, 1) IS NULL THEN true ELSE false END as needs_keywords,
  CASE WHEN t.themes IS NULL OR array_length(t.themes, 1) IS NULL THEN true ELSE false END as needs_themes,
  CASE WHEN t.overview IS NULL OR trim(t.overview) = '' THEN true ELSE false END as needs_overview,
  CASE WHEN t.vibes IS NOT NULL AND array_length(t.vibes, 1) <= 2 THEN true ELSE false END as needs_more_vibes,
  CASE WHEN length(t.profile_string) < 100 THEN true ELSE false END as needs_better_profile,
  -- Priority scoring (higher = more urgent)
  (
    (CASE WHEN t.keywords IS NULL OR array_length(t.keywords, 1) IS NULL THEN 10 ELSE 0 END) + -- Keywords are most critical
    (CASE WHEN t.themes IS NULL OR array_length(t.themes, 1) IS NULL THEN 8 ELSE 0 END) +
    (CASE WHEN t.overview IS NULL OR trim(t.overview) = '' THEN 7 ELSE 0 END) +
    (CASE WHEN t.vibes IS NOT NULL AND array_length(t.vibes, 1) <= 2 THEN 5 ELSE 0 END) +
    (CASE WHEN length(t.profile_string) < 100 THEN 4 ELSE 0 END)
  ) as priority_score
FROM titles t
WHERE
  (t.keywords IS NULL OR array_length(t.keywords, 1) IS NULL)
  OR (t.themes IS NULL OR array_length(t.themes, 1) IS NULL)
  OR (t.overview IS NULL OR trim(t.overview) = '')
  OR (t.vibes IS NOT NULL AND array_length(t.vibes, 1) <= 2)
  OR (length(t.profile_string) < 100)
ORDER BY priority_score DESC, popularity DESC NULLS LAST;

SELECT * FROM backfill_priority_list LIMIT 50;

-- Export statistics
SELECT
  'BACKFILL PRIORITY SUMMARY' as report,
  COUNT(*) as total_records_needing_fixes,
  SUM(CASE WHEN needs_keywords THEN 1 ELSE 0 END) as needs_keywords,
  SUM(CASE WHEN needs_themes THEN 1 ELSE 0 END) as needs_themes,
  SUM(CASE WHEN needs_overview THEN 1 ELSE 0 END) as needs_overview,
  SUM(CASE WHEN needs_more_vibes THEN 1 ELSE 0 END) as needs_more_vibes,
  SUM(CASE WHEN needs_better_profile THEN 1 ELSE 0 END) as needs_better_profile,
  ROUND(AVG(priority_score), 2) as avg_priority_score
FROM backfill_priority_list;


-- ============================================================
-- NOTES FOR EXECUTION
-- ============================================================
/*
1. Run the audit queries first (supabase-cleanup-audit.sql)
2. Review the temp tables created by this script
3. Export backfill_priority_list to CSV for systematic data collection
4. Use TMDB API to backfill keywords, overviews, and metadata
5. Use LLM (Claude/GPT) to enhance themes and vibes where needed
6. After data fixes, regenerate all 3 embeddings for affected records
7. Run quality validation checks to ensure improvements

RECOMMENDED BACKFILL APPROACH:
- Keywords: TMDB API /movie/{id}/keywords or /tv/{id}/keywords
- Overview: TMDB API /movie/{id} or /tv/{id}
- Themes: Extract using LLM from overview + existing metadata
- Vibes: Use LLM to generate atmospheric descriptors
- Profile strings: Regenerate using LLM with overview + themes + slots

After backfilling, you MUST regenerate embeddings for quality improvement.
*/
