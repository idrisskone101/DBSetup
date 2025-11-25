-- Hybrid Search Function: Vector Similarity + BM25 Keyword Matching + Popularity Boost
-- Combines the best of semantic search with exact keyword matching
-- Date: 2025-10-27

CREATE OR REPLACE FUNCTION hybrid_search_titles (
  query_text TEXT,
  query_content_embedding vector(768),
  query_vibe_embedding vector(768),
  query_metadata_embedding vector(768),
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
  -- Calculate semantic weight (remaining after keyword and popularity)
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
      -- Individual vector similarity scores (0-1)
      (1 - (t.content_embedding <=> query_content_embedding))::float as content_score,
      (1 - (t.vibe_embedding <=> query_vibe_embedding))::float as vibe_score,
      (1 - (t.metadata_embedding <=> query_metadata_embedding))::float as metadata_score,
      -- Weighted semantic score
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
      -- BM25-style ranking using ts_rank_cd (cover density ranking)
      -- Normalized to 0-1 range (divide by theoretical max ~1.0)
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
      -- Popularity boost: blend vote_average + vote_count
      -- Normalized to 0-1 range
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
    -- Final blended score
    (
      v.semantic_score * semantic_weight +
      COALESCE(k.keyword_rank, 0) * weight_keyword +
      COALESCE(p.popularity_rank, 0) * weight_popularity
    )::float as combined_score,
    -- Determine strongest signal
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
    -- Must exceed threshold on either semantic or keyword score
    (v.semantic_score > match_threshold OR COALESCE(k.keyword_rank, 0) > match_threshold)
  ORDER BY combined_score DESC
  LIMIT LEAST(match_count, 200);
END;
$$;

-- Example usage:
--
-- SELECT * FROM hybrid_search_titles(
--   'christopher nolan',               -- query text for keyword matching
--   '[0.1, 0.2, ...]'::vector(768),   -- content embedding
--   '[0.1, 0.2, ...]'::vector(768),   -- vibe embedding
--   '[0.1, 0.2, ...]'::vector(768),   -- metadata embedding
--   0.40,  -- content weight (40%)
--   0.35,  -- vibe weight (35%)
--   0.25,  -- metadata weight (25%)
--   0.15,  -- keyword weight (15%)
--   0.10,  -- popularity weight (10%)
--   0.25,  -- minimum similarity threshold
--   10     -- max results
-- );

COMMENT ON FUNCTION hybrid_search_titles IS
'Hybrid search combining vector similarity, BM25 keyword matching, and popularity boosting.
Blends three embedding types (content, vibe, metadata) with full-text keyword search.
Includes popularity boost based on vote_average and vote_count.
Default weights: semantic=75% (content=40%, vibe=35%, metadata=25%), keyword=15%, popularity=10%';
