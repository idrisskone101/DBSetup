-- Migration: Update search functions for 1536 dimensions
-- Date: TBD (run after restoring 1536 dimensions)
-- Purpose: Update match_titles_multi and hybrid_search_titles to use vector(1536)

BEGIN;

-- Update match_titles_multi for 1536 dimensions
CREATE OR REPLACE FUNCTION match_titles_multi (
  query_content_embedding vector(1536),  -- Changed from 768
  query_vibe_embedding vector(1536),      -- Changed from 768
  query_metadata_embedding vector(1536),  -- Changed from 768
  weight_content float DEFAULT 0.40,
  weight_vibe float DEFAULT 0.35,
  weight_metadata float DEFAULT 0.25,
  weight_popularity float DEFAULT 0.10,
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id bigint,
  title text,
  kind text,
  release_date date,
  overview text,
  genres text[],
  director text,
  vibes text[],
  themes text[],
  runtime_minutes int,
  vote_average numeric,
  certification text,
  content_score float,
  vibe_score float,
  metadata_score float,
  popularity_score float,
  combined_score float,
  strongest_signal text
)
LANGUAGE plpgsql
AS $$
DECLARE
  semantic_weight FLOAT;
BEGIN
  semantic_weight := 1.0 - weight_popularity;

  RETURN QUERY
  SELECT
    t.id,
    t.title,
    t.kind,
    t.release_date,
    t.overview,
    t.genres,
    t.director,
    t.vibes,
    t.themes,
    t.runtime_minutes,
    t.vote_average,
    t.certification,
    (1 - (t.content_embedding <=> query_content_embedding))::float as content_score,
    (1 - (t.vibe_embedding <=> query_vibe_embedding))::float as vibe_score,
    (1 - (t.metadata_embedding <=> query_metadata_embedding))::float as metadata_score,
    (
      COALESCE(LEAST(t.vote_average / 10.0, 1.0), 0) * 0.7 +
      COALESCE(LEAST(LOG(GREATEST(t.vote_count, 1)) / 10.0, 1.0), 0) * 0.3
    )::float as popularity_score,
    (
      (
        weight_content * (1 - (t.content_embedding <=> query_content_embedding)) +
        weight_vibe * (1 - (t.vibe_embedding <=> query_vibe_embedding)) +
        weight_metadata * (1 - (t.metadata_embedding <=> query_metadata_embedding))
      ) * semantic_weight +
      (
        COALESCE(LEAST(t.vote_average / 10.0, 1.0), 0) * 0.7 +
        COALESCE(LEAST(LOG(GREATEST(t.vote_count, 1)) / 10.0, 1.0), 0) * 0.3
      ) * weight_popularity
    )::float as combined_score,
    CASE
      WHEN (1 - (t.content_embedding <=> query_content_embedding)) >=
           GREATEST((1 - (t.vibe_embedding <=> query_vibe_embedding)),
                   (1 - (t.metadata_embedding <=> query_metadata_embedding)))
      THEN 'content'
      WHEN (1 - (t.vibe_embedding <=> query_vibe_embedding)) >=
           (1 - (t.metadata_embedding <=> query_metadata_embedding))
      THEN 'vibe'
      ELSE 'metadata'
    END as strongest_signal
  FROM titles t
  WHERE
    t.content_embedding IS NOT NULL AND
    t.vibe_embedding IS NOT NULL AND
    t.metadata_embedding IS NOT NULL AND
    (
      (1 - (t.content_embedding <=> query_content_embedding)) > match_threshold OR
      (1 - (t.vibe_embedding <=> query_vibe_embedding)) > match_threshold OR
      (1 - (t.metadata_embedding <=> query_metadata_embedding)) > match_threshold
    )
  ORDER BY combined_score DESC
  LIMIT LEAST(match_count, 200);
END;
$$;

-- Update hybrid_search_titles for 1536 dimensions
CREATE OR REPLACE FUNCTION hybrid_search_titles (
  query_text TEXT,
  query_content_embedding vector(1536),  -- Changed from 768
  query_vibe_embedding vector(1536),      -- Changed from 768
  query_metadata_embedding vector(1536),  -- Changed from 768
  weight_content FLOAT DEFAULT 0.40,
  weight_vibe FLOAT DEFAULT 0.35,
  weight_metadata FLOAT DEFAULT 0.25,
  weight_keyword FLOAT DEFAULT 0.15,
  weight_popularity FLOAT DEFAULT 0.10,
  match_threshold FLOAT DEFAULT 0.25,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id bigint,
  title text,
  kind text,
  release_date date,
  overview text,
  genres text[],
  director text,
  vibes text[],
  themes text[],
  runtime_minutes int,
  vote_average numeric,
  certification text,
  content_score float,
  vibe_score float,
  metadata_score float,
  keyword_score float,
  popularity_score float,
  combined_score float,
  strongest_signal text
)
LANGUAGE plpgsql
AS $$
DECLARE
  semantic_weight FLOAT;
BEGIN
  semantic_weight := 1.0 - weight_keyword - weight_popularity;

  RETURN QUERY
  WITH vector_scores AS (
    SELECT
      t.id,
      t.title,
      t.kind,
      t.release_date,
      t.overview,
      t.genres,
      t.director,
      t.vibes,
      t.themes,
      t.runtime_minutes,
      t.vote_average,
      t.certification,
      (1 - (t.content_embedding <=> query_content_embedding))::float as content_score,
      (1 - (t.vibe_embedding <=> query_vibe_embedding))::float as vibe_score,
      (1 - (t.metadata_embedding <=> query_metadata_embedding))::float as metadata_score,
      (
        weight_content * (1 - (t.content_embedding <=> query_content_embedding)) +
        weight_vibe * (1 - (t.vibe_embedding <=> query_vibe_embedding)) +
        weight_metadata * (1 - (t.metadata_embedding <=> query_metadata_embedding))
      )::float as semantic_score
    FROM titles t
    WHERE
      t.content_embedding IS NOT NULL AND
      t.vibe_embedding IS NOT NULL AND
      t.metadata_embedding IS NOT NULL
  ),
  keyword_scores AS (
    SELECT
      t.id,
      LEAST(
        ts_rank_cd(t.search_vector, plainto_tsquery('english', query_text), 32) / 1.0,
        1.0
      )::float as keyword_rank
    FROM titles t
    WHERE
      t.search_vector IS NOT NULL AND
      t.search_vector @@ plainto_tsquery('english', query_text)
  ),
  popularity_scores AS (
    SELECT
      t.id,
      (
        COALESCE(LEAST(t.vote_average / 10.0, 1.0), 0) * 0.7 +
        COALESCE(LEAST(LOG(GREATEST(t.vote_count, 1)) / 10.0, 1.0), 0) * 0.3
      )::float as popularity_rank
    FROM titles t
  )
  SELECT
    v.id,
    v.title,
    v.kind,
    v.release_date,
    v.overview,
    v.genres,
    v.director,
    v.vibes,
    v.themes,
    v.runtime_minutes,
    v.vote_average,
    v.certification,
    v.content_score,
    v.vibe_score,
    v.metadata_score,
    COALESCE(k.keyword_rank, 0)::float as keyword_score,
    COALESCE(p.popularity_rank, 0)::float as popularity_score,
    (
      v.semantic_score * semantic_weight +
      COALESCE(k.keyword_rank, 0) * weight_keyword +
      COALESCE(p.popularity_rank, 0) * weight_popularity
    )::float as combined_score,
    CASE
      WHEN COALESCE(k.keyword_rank, 0) >= GREATEST(v.semantic_score, COALESCE(p.popularity_rank, 0))
      THEN 'keyword'
      WHEN v.content_score >= GREATEST(v.vibe_score, v.metadata_score)
      THEN 'content'
      WHEN v.vibe_score >= v.metadata_score
      THEN 'vibe'
      ELSE 'metadata'
    END as strongest_signal
  FROM vector_scores v
  LEFT JOIN keyword_scores k ON v.id = k.id
  LEFT JOIN popularity_scores p ON v.id = p.id
  WHERE
    (v.semantic_score > match_threshold OR COALESCE(k.keyword_rank, 0) > match_threshold)
  ORDER BY combined_score DESC
  LIMIT LEAST(match_count, 200);
END;
$$;

COMMIT;

-- Next steps when restoring to 1536:
-- 1. Run FUTURE-restore-1536-dimensions.sql
-- 2. Run this migration
-- 3. Update embeddings.js: remove 'dimensions: 768' from OpenAI calls
-- 4. Run regeneration script to create 1536-dim embeddings
