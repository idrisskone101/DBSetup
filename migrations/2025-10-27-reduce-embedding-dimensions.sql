-- Migration: Reduce embedding dimensions from 1536 to 768 (Matryoshka)
-- Date: 2025-10-27
-- Reason: Matryoshka Representation Learning provides better performance on small datasets
-- Impact: All 3 embedding columns (content, vibe, metadata) will be resized

-- IMPORTANT: This migration will drop existing embeddings!
-- Run the regeneration script (regenerate-embeddings-768.js) after this migration

BEGIN;

-- Step 1: Drop existing HNSW indexes (required before altering column type)
DROP INDEX IF EXISTS titles_embedding_idx;
DROP INDEX IF EXISTS titles_embedding_hnsw;
DROP INDEX IF EXISTS titles_content_embedding_idx;
DROP INDEX IF EXISTS titles_vibe_embedding_idx;
DROP INDEX IF EXISTS titles_metadata_embedding_idx;

-- Step 2: Drop existing embeddings (they will be regenerated at 768 dims)
UPDATE titles
SET
  content_embedding = NULL,
  vibe_embedding = NULL,
  metadata_embedding = NULL;

-- Step 3: Alter column types to vector(768)
ALTER TABLE titles
  ALTER COLUMN content_embedding TYPE vector(768);

ALTER TABLE titles
  ALTER COLUMN vibe_embedding TYPE vector(768);

ALTER TABLE titles
  ALTER COLUMN metadata_embedding TYPE vector(768);

-- Step 4: Update column comments
COMMENT ON COLUMN titles.content_embedding IS
  'Embedding for story/narrative content (768 dims via Matryoshka): profile_string, themes, overview, slots, keywords';

COMMENT ON COLUMN titles.vibe_embedding IS
  'Embedding for emotional/atmospheric profile (768 dims via Matryoshka): vibes, tone, pacing, tagline';

COMMENT ON COLUMN titles.metadata_embedding IS
  'Embedding for factual/categorical data (768 dims via Matryoshka): genres, director, writers, certification, countries, collection';

-- Step 5: Create HNSW indexes for new 768-dimensional vectors
-- Using m=16, ef_construction=64 (balanced performance for ~1000 titles)
CREATE INDEX titles_content_embedding_768_idx
  ON titles
  USING hnsw (content_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX titles_vibe_embedding_768_idx
  ON titles
  USING hnsw (vibe_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX titles_metadata_embedding_768_idx
  ON titles
  USING hnsw (metadata_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMIT;

-- Verification query (run after migration)
-- SELECT
--   COUNT(*) as total_titles,
--   COUNT(content_embedding) as has_content_768,
--   COUNT(vibe_embedding) as has_vibe_768,
--   COUNT(metadata_embedding) as has_metadata_768
-- FROM titles;

-- Expected result after migration: all embedding counts should be 0
-- After running regenerate-embeddings-768.js: all counts should be 990

-- Next steps:
-- 1. Run this migration: psql < migrations/2025-10-27-reduce-embedding-dimensions.sql
-- 2. Run regeneration script: node regenerate-embeddings-768.js
-- 3. Verify all embeddings regenerated successfully
