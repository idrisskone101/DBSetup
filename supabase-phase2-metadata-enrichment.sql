-- ============================================================
-- PHASE 2: METADATA ENRICHMENT
-- ============================================================
-- Enhance metadata fields to improve metadata_embedding quality
-- These are secondary priority but important for scaling to 10k-100k
-- ============================================================

-- ============================================================
-- 1. IDENTIFY MOVIES MISSING DIRECTOR (891 records)
-- ============================================================
-- Directors are critical metadata for movies (less so for TV shows which use creators)

CREATE TEMP TABLE IF NOT EXISTS needs_director AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  release_date,
  popularity,
  vote_average,
  -- Fetch from TMDB API /movie/{id}/credits (crew with job="Director")
  'TMDB API: /movie/{id}/credits' as data_source
FROM titles
WHERE kind = 'movie' AND (director IS NULL OR trim(director) = '')
ORDER BY popularity DESC NULLS LAST;

SELECT COUNT(*) as movies_missing_director FROM needs_director;

-- High priority movies (popular titles) missing director
SELECT * FROM needs_director
WHERE popularity > 10 OR vote_average > 7
LIMIT 50;

COMMENT ON TABLE needs_director IS 'Movies missing director information. Fetch from TMDB /movie/{id}/credits endpoint.';


-- ============================================================
-- 2. IDENTIFY RECORDS MISSING CAST (793 records)
-- ============================================================
-- Cast information enriches metadata_embedding for better recommendations

CREATE TEMP TABLE IF NOT EXISTS needs_cast AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  release_date,
  popularity,
  vote_average,
  -- Fetch top 10 cast from TMDB API
  CASE
    WHEN kind = 'movie' THEN 'TMDB API: /movie/{id}/credits'
    WHEN kind = 'tv' THEN 'TMDB API: /tv/{id}/aggregate_credits or /tv/{id}/credits'
  END as data_source
FROM titles
WHERE "cast" IS NULL OR jsonb_array_length("cast") = 0
ORDER BY popularity DESC NULLS LAST;

SELECT COUNT(*) as records_missing_cast FROM needs_cast;

-- High priority titles missing cast
SELECT * FROM needs_cast
WHERE popularity > 20 OR vote_average > 7.5
LIMIT 50;

COMMENT ON TABLE needs_cast IS 'Records missing cast information. Fetch from TMDB credits endpoint.';


-- ============================================================
-- 3. IDENTIFY TV SHOWS MISSING CREATORS
-- ============================================================
-- TV show creators are equivalent to movie directors

SELECT
  'TV SHOWS MISSING CREATORS' as issue_type,
  COUNT(*) as count
FROM titles
WHERE kind = 'tv' AND (creators IS NULL OR array_length(creators, 1) IS NULL);

CREATE TEMP TABLE IF NOT EXISTS needs_creators AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  release_date,
  popularity,
  -- Fetch from TMDB API /tv/{id} (created_by field)
  'TMDB API: /tv/{id}' as data_source
FROM titles
WHERE kind = 'tv' AND (creators IS NULL OR array_length(creators, 1) IS NULL)
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM needs_creators LIMIT 30;


-- ============================================================
-- 4. IDENTIFY RECORDS MISSING WRITERS
-- ============================================================
-- Writers provide additional metadata signal

CREATE TEMP TABLE IF NOT EXISTS needs_writers AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  director,
  creators,
  -- Fetch from TMDB credits (crew with department="Writing")
  CASE
    WHEN kind = 'movie' THEN 'TMDB API: /movie/{id}/credits (crew -> Writing dept)'
    WHEN kind = 'tv' THEN 'TMDB API: /tv/{id}/credits (crew -> Writing dept)'
  END as data_source
FROM titles
WHERE writers IS NULL OR array_length(writers, 1) IS NULL
ORDER BY popularity DESC NULLS LAST;

SELECT
  kind,
  COUNT(*) as missing_writers_count
FROM needs_writers
GROUP BY kind;

SELECT * FROM needs_writers LIMIT 30;


-- ============================================================
-- 5. MISSING CERTIFICATION/AGE RATING
-- ============================================================
-- Age ratings help with content filtering and recommendations

SELECT
  'MISSING CERTIFICATION' as issue_type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM titles), 2) as percentage
FROM titles
WHERE certification IS NULL OR trim(certification) = '';

CREATE TEMP TABLE IF NOT EXISTS needs_certification AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  release_date,
  -- Fetch US certification from TMDB
  CASE
    WHEN kind = 'movie' THEN 'TMDB API: /movie/{id}/release_dates (US certification)'
    WHEN kind = 'tv' THEN 'TMDB API: /tv/{id}/content_ratings (US rating)'
  END as data_source
FROM titles
WHERE certification IS NULL OR trim(certification) = ''
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM needs_certification LIMIT 30;


-- ============================================================
-- 6. MISSING PRODUCTION COUNTRIES
-- ============================================================
-- Production countries provide geographic context

SELECT
  'MISSING PRODUCTION COUNTRIES' as issue_type,
  COUNT(*) as count
FROM titles
WHERE production_countries IS NULL OR array_length(production_countries, 1) IS NULL;

CREATE TEMP TABLE IF NOT EXISTS needs_production_countries AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  -- Fetch from TMDB base endpoint
  CASE
    WHEN kind = 'movie' THEN 'TMDB API: /movie/{id} (production_countries)'
    WHEN kind = 'tv' THEN 'TMDB API: /tv/{id} (production_countries)'
  END as data_source
FROM titles
WHERE production_countries IS NULL OR array_length(production_countries, 1) IS NULL
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM needs_production_countries LIMIT 30;


-- ============================================================
-- 7. MISSING COLLECTION/FRANCHISE INFO
-- ============================================================
-- Collection info helps group franchises (e.g., MCU, Harry Potter)

SELECT
  'MOVIES IN COLLECTIONS' as metric,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM titles WHERE kind = 'movie'), 2) as percentage
FROM titles
WHERE kind = 'movie' AND collection_id IS NOT NULL;

CREATE TEMP TABLE IF NOT EXISTS potential_franchise_movies AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  collection_id,
  collection_name,
  -- Fetch from TMDB /movie/{id} (belongs_to_collection)
  'TMDB API: /movie/{id}' as data_source
FROM titles
WHERE
  kind = 'movie'
  AND collection_id IS NULL
  AND (
    -- Heuristic: titles containing numbers or franchise keywords
    title ~ '\d+'
    OR title ~* '(Part|Chapter|Episode|Vol|Volume|Returns|Rises|Begins|Revenge|The|Legacy|Origins)'
  )
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM potential_franchise_movies LIMIT 30;


-- ============================================================
-- 8. MISSING TAGLINES
-- ============================================================
-- Taglines can enhance vibe_embedding

SELECT
  'MISSING TAGLINES' as issue_type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM titles), 2) as percentage
FROM titles
WHERE tagline IS NULL OR trim(tagline) = '';

CREATE TEMP TABLE IF NOT EXISTS needs_tagline AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  popularity,
  -- Fetch from TMDB base endpoint
  CASE
    WHEN kind = 'movie' THEN 'TMDB API: /movie/{id} (tagline)'
    WHEN kind = 'tv' THEN 'TMDB API: /tv/{id} (tagline)'
  END as data_source
FROM titles
WHERE tagline IS NULL OR trim(tagline) = ''
ORDER BY popularity DESC NULLS LAST
LIMIT 200; -- Only backfill taglines for most popular titles

SELECT * FROM needs_tagline LIMIT 30;


-- ============================================================
-- 9. MISSING RUNTIME
-- ============================================================
-- Runtime is useful metadata for filtering

SELECT
  'MISSING RUNTIME' as issue_type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM titles), 2) as percentage
FROM titles
WHERE runtime_minutes IS NULL;

CREATE TEMP TABLE IF NOT EXISTS needs_runtime AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  -- For movies: single runtime value
  -- For TV: average episode runtime
  CASE
    WHEN kind = 'movie' THEN 'TMDB API: /movie/{id} (runtime)'
    WHEN kind = 'tv' THEN 'TMDB API: /tv/{id} (episode_run_time[0])'
  END as data_source
FROM titles
WHERE runtime_minutes IS NULL
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM needs_runtime LIMIT 30;


-- ============================================================
-- 10. MISSING POSTER/BACKDROP PATHS
-- ============================================================
-- Visual assets for UI presentation

SELECT
  'MISSING POSTER' as issue_type,
  COUNT(*) as count
FROM titles
WHERE poster_path IS NULL OR trim(poster_path) = '';

SELECT
  'MISSING BACKDROP' as issue_type,
  COUNT(*) as count
FROM titles
WHERE backdrop_path IS NULL OR trim(backdrop_path) = '';

CREATE TEMP TABLE IF NOT EXISTS needs_images AS
SELECT
  id,
  title,
  kind,
  imdb_id,
  CASE WHEN poster_path IS NULL OR trim(poster_path) = '' THEN true ELSE false END as needs_poster,
  CASE WHEN backdrop_path IS NULL OR trim(backdrop_path) = '' THEN true ELSE false END as needs_backdrop,
  -- Fetch from TMDB base endpoint
  CASE
    WHEN kind = 'movie' THEN 'TMDB API: /movie/{id}'
    WHEN kind = 'tv' THEN 'TMDB API: /tv/{id}'
  END as data_source
FROM titles
WHERE
  (poster_path IS NULL OR trim(poster_path) = '')
  OR (backdrop_path IS NULL OR trim(backdrop_path) = '')
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM needs_images LIMIT 30;


-- ============================================================
-- 11. FIX MISSING PACING (1 record)
-- ============================================================
-- Only 1 record missing pacing - should be quick fix

SELECT
  id,
  title,
  kind,
  tone,
  pacing,
  vibes,
  genres,
  overview
FROM titles
WHERE pacing IS NULL OR trim(pacing) = '';

-- Manual fix based on context
-- Example: If it's "Fargo" (darkly comedic crime thriller)
-- Suggested pacing: "methodical" or "slow-burn"

/*
EXAMPLE UPDATE:
UPDATE titles
SET pacing = 'methodical'
WHERE id = 60622; -- Fargo
*/


-- ============================================================
-- 12. METADATA ENRICHMENT PRIORITY MATRIX
-- ============================================================
-- Prioritize backfilling based on popularity and completeness

CREATE TEMP TABLE IF NOT EXISTS metadata_enrichment_priority AS
SELECT
  t.id,
  t.title,
  t.kind,
  t.imdb_id,
  t.popularity,
  t.vote_average,
  -- Metadata completeness flags
  CASE WHEN t.director IS NULL AND t.kind = 'movie' THEN false ELSE true END as has_director,
  CASE WHEN t.creators IS NULL AND t.kind = 'tv' THEN false ELSE true END as has_creators,
  CASE WHEN t."cast" IS NULL OR jsonb_array_length(t."cast") = 0 THEN false ELSE true END as has_cast,
  CASE WHEN t.writers IS NULL OR array_length(t.writers, 1) IS NULL THEN false ELSE true END as has_writers,
  CASE WHEN t.certification IS NULL THEN false ELSE true END as has_certification,
  CASE WHEN t.production_countries IS NULL THEN false ELSE true END as has_production_countries,
  CASE WHEN t.runtime_minutes IS NULL THEN false ELSE true END as has_runtime,
  CASE WHEN t.poster_path IS NULL THEN false ELSE true END as has_poster,
  -- Metadata completeness score (0-8)
  (
    (CASE WHEN t.director IS NOT NULL OR t.kind = 'tv' THEN 1 ELSE 0 END) +
    (CASE WHEN t.creators IS NOT NULL OR t.kind = 'movie' THEN 1 ELSE 0 END) +
    (CASE WHEN t."cast" IS NOT NULL AND jsonb_array_length(t."cast") > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN t.writers IS NOT NULL AND array_length(t.writers, 1) > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN t.certification IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN t.production_countries IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN t.runtime_minutes IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN t.poster_path IS NOT NULL THEN 1 ELSE 0 END)
  ) as metadata_completeness_score,
  -- Priority score (higher = more urgent)
  -- Popular titles with incomplete metadata should be prioritized
  CASE
    WHEN t.popularity > 50 THEN 10
    WHEN t.popularity > 20 THEN 7
    WHEN t.popularity > 10 THEN 5
    WHEN t.vote_average > 8 THEN 6
    WHEN t.vote_average > 7 THEN 4
    ELSE 2
  END as priority_weight
FROM titles t
ORDER BY
  priority_weight DESC,
  metadata_completeness_score ASC,
  popularity DESC NULLS LAST;

-- View top priority titles needing metadata enrichment
SELECT *
FROM metadata_enrichment_priority
WHERE metadata_completeness_score < 6
LIMIT 50;

-- Statistics
SELECT
  metadata_completeness_score,
  COUNT(*) as title_count,
  ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM titles), 2) as percentage
FROM metadata_enrichment_priority
GROUP BY metadata_completeness_score
ORDER BY metadata_completeness_score DESC;


-- ============================================================
-- 13. CONSOLIDATED BACKFILL EXPORT
-- ============================================================
-- Export a single list with all metadata needs for systematic backfilling

CREATE TEMP TABLE IF NOT EXISTS metadata_backfill_checklist AS
SELECT
  t.id,
  t.title,
  t.kind,
  t.imdb_id,
  t.popularity,
  -- What needs to be backfilled
  CASE WHEN t.director IS NULL AND t.kind = 'movie' THEN true ELSE false END as fetch_director,
  CASE WHEN t.creators IS NULL AND t.kind = 'tv' THEN true ELSE false END as fetch_creators,
  CASE WHEN t."cast" IS NULL OR jsonb_array_length(t."cast") = 0 THEN true ELSE false END as fetch_cast,
  CASE WHEN t.writers IS NULL OR array_length(t.writers, 1) IS NULL THEN true ELSE false END as fetch_writers,
  CASE WHEN t.certification IS NULL THEN true ELSE false END as fetch_certification,
  CASE WHEN t.production_countries IS NULL THEN true ELSE false END as fetch_production_countries,
  CASE WHEN t.runtime_minutes IS NULL THEN true ELSE false END as fetch_runtime,
  CASE WHEN t.poster_path IS NULL THEN true ELSE false END as fetch_poster,
  CASE WHEN t.backdrop_path IS NULL THEN true ELSE false END as fetch_backdrop,
  CASE WHEN t.tagline IS NULL AND t.popularity > 20 THEN true ELSE false END as fetch_tagline,
  -- Count of fields to backfill
  (
    (CASE WHEN t.director IS NULL AND t.kind = 'movie' THEN 1 ELSE 0 END) +
    (CASE WHEN t.creators IS NULL AND t.kind = 'tv' THEN 1 ELSE 0 END) +
    (CASE WHEN t."cast" IS NULL OR jsonb_array_length(t."cast") = 0 THEN 1 ELSE 0 END) +
    (CASE WHEN t.writers IS NULL OR array_length(t.writers, 1) IS NULL THEN 1 ELSE 0 END) +
    (CASE WHEN t.certification IS NULL THEN 1 ELSE 0 END) +
    (CASE WHEN t.production_countries IS NULL THEN 1 ELSE 0 END) +
    (CASE WHEN t.runtime_minutes IS NULL THEN 1 ELSE 0 END) +
    (CASE WHEN t.poster_path IS NULL THEN 1 ELSE 0 END) +
    (CASE WHEN t.backdrop_path IS NULL THEN 1 ELSE 0 END)
  ) as fields_to_backfill
FROM titles t
WHERE
  (t.director IS NULL AND t.kind = 'movie')
  OR (t.creators IS NULL AND t.kind = 'tv')
  OR (t."cast" IS NULL OR jsonb_array_length(t."cast") = 0)
  OR (t.writers IS NULL OR array_length(t.writers, 1) IS NULL)
  OR t.certification IS NULL
  OR t.production_countries IS NULL
  OR t.runtime_minutes IS NULL
  OR t.poster_path IS NULL
  OR t.backdrop_path IS NULL
ORDER BY popularity DESC NULLS LAST;

SELECT * FROM metadata_backfill_checklist LIMIT 50;

-- Summary
SELECT
  'METADATA BACKFILL SUMMARY' as report,
  COUNT(*) as total_records_needing_metadata,
  SUM(CASE WHEN fetch_director THEN 1 ELSE 0 END) as need_director,
  SUM(CASE WHEN fetch_creators THEN 1 ELSE 0 END) as need_creators,
  SUM(CASE WHEN fetch_cast THEN 1 ELSE 0 END) as need_cast,
  SUM(CASE WHEN fetch_writers THEN 1 ELSE 0 END) as need_writers,
  SUM(CASE WHEN fetch_certification THEN 1 ELSE 0 END) as need_certification,
  SUM(CASE WHEN fetch_production_countries THEN 1 ELSE 0 END) as need_production_countries,
  SUM(CASE WHEN fetch_runtime THEN 1 ELSE 0 END) as need_runtime,
  ROUND(AVG(fields_to_backfill), 2) as avg_fields_per_record
FROM metadata_backfill_checklist;


-- ============================================================
-- NOTES FOR EXECUTION
-- ============================================================
/*
PHASE 2 BACKFILLING STRATEGY:

1. Use TMDB API for all metadata backfilling
2. Batch requests by TMDB ID to optimize API calls
3. Prioritize high-popularity titles first (popularity > 20)
4. Store API responses in payload JSONB for future reference

RECOMMENDED API ENDPOINTS:
- Movie metadata: GET /movie/{movie_id}
- Movie credits: GET /movie/{movie_id}/credits
- Movie certifications: GET /movie/{movie_id}/release_dates
- TV metadata: GET /tv/{tv_id}
- TV credits: GET /tv/{tv_id}/aggregate_credits
- TV certifications: GET /tv/{tv_id}/content_ratings

AFTER BACKFILLING:
- Regenerate metadata_embedding for records with significant metadata additions
- Focus on titles where director, cast, or certification was added
*/
