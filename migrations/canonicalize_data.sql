-- Data Canonicalization Migration
-- This migration standardizes genres, vibes, themes, tone, and pacing values

-- ============================================================================
-- HELPER FUNCTION: Replace array element
-- ============================================================================
CREATE OR REPLACE FUNCTION array_replace(
  arr text[],
  old_val text,
  new_val text
)
RETURNS text[] AS $$
  SELECT array_agg(CASE WHEN elem = old_val THEN new_val ELSE elem END)
  FROM unnest(arr) AS elem;
$$ LANGUAGE SQL IMMUTABLE;

-- ============================================================================
-- HELPER FUNCTION: Replace and split array element
-- ============================================================================
CREATE OR REPLACE FUNCTION array_replace_and_split(
  arr text[],
  old_val text,
  new_vals text[]
)
RETURNS text[] AS $$
  SELECT array_agg(DISTINCT elem ORDER BY elem)
  FROM (
    SELECT CASE
      WHEN elem = old_val THEN unnest(new_vals)
      ELSE elem
    END AS elem
    FROM unnest(arr) AS elem
  ) sub;
$$ LANGUAGE SQL IMMUTABLE;

-- ============================================================================
-- STEP 1: CANONICALIZE GENRES
-- ============================================================================
BEGIN;

-- Normalize case for all genres first
UPDATE titles
SET genres = (
  SELECT array_agg(DISTINCT LOWER(genre) ORDER BY LOWER(genre))
  FROM unnest(genres) AS genre
)
WHERE genres IS NOT NULL;

-- Split compound genres
UPDATE titles
SET genres = array_replace_and_split(genres, 'sci-fi & fantasy', ARRAY['science fiction', 'fantasy'])
WHERE 'sci-fi & fantasy' = ANY(genres);

UPDATE titles
SET genres = array_replace_and_split(genres, 'action & adventure', ARRAY['action', 'adventure'])
WHERE 'action & adventure' = ANY(genres);

UPDATE titles
SET genres = array_replace_and_split(genres, 'war & politics', ARRAY['war', 'politics'])
WHERE 'war & politics' = ANY(genres);

-- Remove duplicates and sort
UPDATE titles
SET genres = (
  SELECT array_agg(DISTINCT genre ORDER BY genre)
  FROM unnest(genres) AS genre
)
WHERE genres IS NOT NULL;

COMMIT;

-- ============================================================================
-- STEP 2: CANONICALIZE VIBES
-- ============================================================================
BEGIN;

-- Normalize hyphenation: light-hearted → lighthearted
UPDATE titles
SET vibes = (
  SELECT array_agg(DISTINCT replace(vibe, 'light-hearted', 'lighthearted') ORDER BY replace(vibe, 'light-hearted', 'lighthearted'))
  FROM unnest(vibes) AS vibe
)
WHERE vibes IS NOT NULL AND EXISTS (
  SELECT 1 FROM unnest(vibes) AS vibe WHERE vibe LIKE '%light-hearted%'
);

-- Consolidate dark comedy variations
UPDATE titles
SET vibes = array_replace(vibes, 'darkly comic', 'darkly comedic')
WHERE 'darkly comic' = ANY(vibes);

UPDATE titles
SET vibes = array_replace(vibes, 'dark comedy', 'darkly comedic')
WHERE 'dark comedy' = ANY(vibes);

-- Normalize 80s → 1980s
UPDATE titles
SET vibes = (
  SELECT array_agg(DISTINCT replace(vibe, '80s', '1980s') ORDER BY replace(vibe, '80s', '1980s'))
  FROM unnest(vibes) AS vibe
)
WHERE vibes IS NOT NULL AND EXISTS (
  SELECT 1 FROM unnest(vibes) AS vibe WHERE vibe LIKE '%80s%' AND vibe NOT LIKE '%1980s%'
);

-- Normalize case variations
UPDATE titles
SET vibes = array_replace(vibes, 'Gothic fantasy', 'gothic fantasy')
WHERE 'Gothic fantasy' = ANY(vibes);

UPDATE titles
SET vibes = array_replace(vibes, 'Gothic horror', 'gothic horror')
WHERE 'Gothic horror' = ANY(vibes);

UPDATE titles
SET vibes = array_replace(vibes, '1930s Southern Gothic', '1930s southern gothic')
WHERE '1930s Southern Gothic' = ANY(vibes);

-- Lowercase all vibes
UPDATE titles
SET vibes = (
  SELECT array_agg(DISTINCT LOWER(vibe) ORDER BY LOWER(vibe))
  FROM unnest(vibes) AS vibe
)
WHERE vibes IS NOT NULL;

-- Remove duplicates after all transformations
UPDATE titles
SET vibes = (
  SELECT array_agg(DISTINCT vibe ORDER BY vibe)
  FROM unnest(vibes) AS vibe
)
WHERE vibes IS NOT NULL;

COMMIT;

-- ============================================================================
-- STEP 3: CANONICALIZE THEMES
-- ============================================================================
BEGIN;

-- Standardize "coming of age" variations
UPDATE titles
SET themes = array_replace(themes, 'coming of age', 'coming-of-age')
WHERE 'coming of age' = ANY(themes);

-- Lowercase all themes
UPDATE titles
SET themes = (
  SELECT array_agg(DISTINCT LOWER(theme) ORDER BY LOWER(theme))
  FROM unnest(themes) AS theme
)
WHERE themes IS NOT NULL;

-- Remove duplicates
UPDATE titles
SET themes = (
  SELECT array_agg(DISTINCT theme ORDER BY theme)
  FROM unnest(themes) AS theme
)
WHERE themes IS NOT NULL;

COMMIT;

-- ============================================================================
-- STEP 4: CANONICALIZE TONE
-- ============================================================================
BEGIN;

-- Normalize hyphenation: light-hearted → lighthearted
UPDATE titles
SET tone = replace(tone, 'light-hearted', 'lighthearted')
WHERE tone LIKE '%light-hearted%';

-- Consolidate dark comedy variations
UPDATE titles
SET tone = 'darkly comedic'
WHERE tone = 'darkly comic';

-- Lowercase all tones
UPDATE titles
SET tone = LOWER(tone)
WHERE tone IS NOT NULL;

COMMIT;

-- ============================================================================
-- STEP 5: CANONICALIZE PACING
-- ============================================================================
BEGIN;

-- Lowercase all pacing
UPDATE titles
SET pacing = LOWER(pacing)
WHERE pacing IS NOT NULL;

COMMIT;

-- ============================================================================
-- CLEANUP: Drop helper functions
-- ============================================================================
DROP FUNCTION IF EXISTS array_replace(text[], text, text);
DROP FUNCTION IF EXISTS array_replace_and_split(text[], text, text[]);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check distinct counts after canonicalization
SELECT
  'genres' as column_name,
  COUNT(DISTINCT genre) as distinct_count
FROM (SELECT unnest(genres) as genre FROM titles WHERE genres IS NOT NULL) sub
UNION ALL
SELECT
  'vibes' as column_name,
  COUNT(DISTINCT vibe) as distinct_count
FROM (SELECT unnest(vibes) as vibe FROM titles WHERE vibes IS NOT NULL) sub
UNION ALL
SELECT
  'themes' as column_name,
  COUNT(DISTINCT theme) as distinct_count
FROM (SELECT unnest(themes) as theme FROM titles WHERE themes IS NOT NULL) sub
UNION ALL
SELECT
  'tone' as column_name,
  COUNT(DISTINCT tone) as distinct_count
FROM titles WHERE tone IS NOT NULL
UNION ALL
SELECT
  'pacing' as column_name,
  COUNT(DISTINCT pacing) as distinct_count
FROM titles WHERE pacing IS NOT NULL;
