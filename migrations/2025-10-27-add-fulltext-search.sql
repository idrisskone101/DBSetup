-- Migration: Add Full-Text Search Support
-- Date: 2025-10-27
-- Purpose: Enable hybrid BM25 + vector search for better exact keyword matching
-- Strategy: Title-weighted tsvector with auto-update trigger

BEGIN;

-- Step 1: Add tsvector column for full-text search
ALTER TABLE titles
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Step 2: Create function to generate weighted search vector
-- Weights: A (title) = highest, B (overview) = medium, C (profile_string) = lower
CREATE OR REPLACE FUNCTION titles_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.original_title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.overview, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.profile_string, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.tagline, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.themes, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.vibes, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.keywords, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.genres, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.director, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.writers, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.creators, ' '), '')), 'B');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create trigger to auto-update search_vector on INSERT/UPDATE
DROP TRIGGER IF EXISTS titles_search_vector_trigger ON titles;

CREATE TRIGGER titles_search_vector_trigger
  BEFORE INSERT OR UPDATE ON titles
  FOR EACH ROW
  EXECUTE FUNCTION titles_search_vector_update();

-- Step 4: Backfill search_vector for existing rows
UPDATE titles SET search_vector = NULL; -- Force trigger to run
UPDATE titles SET updated_at = updated_at; -- Trigger the trigger

-- Step 5: Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS titles_search_vector_idx
  ON titles
  USING GIN (search_vector);

-- Step 6: Add comment
COMMENT ON COLUMN titles.search_vector IS
  'Full-text search vector with title-weighted tokens for hybrid BM25 + vector search';

COMMIT;

-- Verification queries (run after migration)

-- Test 1: Check that all titles have search_vector populated
-- SELECT COUNT(*) as total, COUNT(search_vector) as with_search_vector FROM titles;

-- Test 2: Test full-text search
-- SELECT title, ts_rank_cd(search_vector, plainto_tsquery('english', 'nolan')) as rank
-- FROM titles
-- WHERE search_vector @@ plainto_tsquery('english', 'nolan')
-- ORDER BY rank DESC
-- LIMIT 10;

-- Test 3: Verify title gets highest weight
-- SELECT title,
--   ts_rank_cd(search_vector, plainto_tsquery('english', 'dark')) as rank,
--   search_vector
-- FROM titles
-- WHERE title ILIKE '%dark%' OR overview ILIKE '%dark%'
-- LIMIT 5;

-- Next steps:
-- 1. Run this migration: psql < migrations/2025-10-27-add-fulltext-search.sql
-- 2. Verify all titles have search_vector populated
-- 3. Test full-text search performance
-- 4. Create hybrid search function combining vector + BM25
