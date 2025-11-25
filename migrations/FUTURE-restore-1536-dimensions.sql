-- Migration: Restore embedding dimensions from 768 to 1536 (for scaling)
-- Date: TBD (run when dataset exceeds ~5000 titles)
-- Reason: Full 1536 dimensions provide better accuracy on large datasets
-- Impact: All 3 embedding columns (content, vibe, metadata) will be resized

-- IMPORTANT: This migration will drop existing 768-dim embeddings!
-- Run the regeneration script with 1536 dims after this migration

BEGIN;

-- Step 1: Drop existing HNSW indexes (required before altering column type)
DROP INDEX IF EXISTS titles_content_embedding_768_idx;
DROP INDEX IF EXISTS titles_vibe_embedding_768_idx;
DROP INDEX IF EXISTS titles_metadata_embedding_768_idx;

-- Step 2: Drop existing embeddings (they will be regenerated at 1536 dims)
UPDATE titles
SET
  content_embedding = NULL,
  vibe_embedding = NULL,
  metadata_embedding = NULL;

-- Step 3: Alter column types to vector(1536)
ALTER TABLE titles
  ALTER COLUMN content_embedding TYPE vector(1536);

ALTER TABLE titles
  ALTER COLUMN vibe_embedding TYPE vector(1536);

ALTER TABLE titles
  ALTER COLUMN metadata_embedding TYPE vector(1536);

-- Step 4: Update column comments
COMMENT ON COLUMN titles.content_embedding IS
  'Embedding for story/narrative content (1536 dims - full accuracy): profile_string, themes, overview, slots, keywords';

COMMENT ON COLUMN titles.vibe_embedding IS
  'Embedding for emotional/atmospheric profile (1536 dims - full accuracy): vibes, tone, pacing, tagline';

COMMENT ON COLUMN titles.metadata_embedding IS
  'Embedding for factual/categorical data (1536 dims - full accuracy): genres, director, writers, certification, countries, collection';

-- Step 5: Create HNSW indexes for 1536-dimensional vectors
-- For larger datasets (5k-10k titles), use higher m and ef_construction
-- m=24, ef_construction=128 provides better recall on large datasets
CREATE INDEX titles_content_embedding_1536_idx
  ON titles
  USING hnsw (content_embedding vector_cosine_ops)
  WITH (m = 24, ef_construction = 128);

CREATE INDEX titles_vibe_embedding_1536_idx
  ON titles
  USING hnsw (vibe_embedding vector_cosine_ops)
  WITH (m = 24, ef_construction = 128);

CREATE INDEX titles_metadata_embedding_1536_idx
  ON titles
  USING hnsw (metadata_embedding vector_cosine_ops)
  WITH (m = 24, ef_construction = 128);

COMMIT;

-- Verification query (run after migration)
-- SELECT
--   COUNT(*) as total_titles,
--   COUNT(content_embedding) as has_content_1536,
--   COUNT(vibe_embedding) as has_vibe_1536,
--   COUNT(metadata_embedding) as has_metadata_1536
-- FROM titles;

-- Expected result after migration: all embedding counts should be 0
-- After running regenerate script: all counts should equal total_titles

-- Next steps:
-- 1. Apply this migration when dataset > 5000 titles
-- 2. Update embeddings.js to use full 1536 dimensions (remove dimensions: 768)
-- 3. Run regeneration script to create 1536-dim embeddings
-- 4. Update match_titles_multi and hybrid_search_titles functions to use vector(1536)
