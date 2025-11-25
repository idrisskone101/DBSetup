-- Migration: Add Popularity Boosting to Vector Search
-- Date: 2025-10-27
-- Purpose: Blend semantic similarity with content quality/popularity signals
-- Impact: Improves result relevance by surfacing high-quality content

BEGIN;

-- Update the match_titles_multi function to include popularity boost
CREATE OR REPLACE FUNCTION match_titles_multi (
  query_content_embedding vector(768),
  query_vibe_embedding vector(768),
  query_metadata_embedding vector(768),
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
  -- Calculate semantic weight (remaining after popularity boost)
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
    -- Individual similarity scores (0-1, higher is better)
    (1 - (t.content_embedding <=> query_content_embedding))::float as content_score,
    (1 - (t.vibe_embedding <=> query_vibe_embedding))::float as vibe_score,
    (1 - (t.metadata_embedding <=> query_metadata_embedding))::float as metadata_score,
    -- Popularity score (0-1, blending vote_average + vote_count)
    (
      COALESCE(LEAST(t.vote_average / 10.0, 1.0), 0) * 0.7 +
      COALESCE(LEAST(LOG(GREATEST(t.vote_count, 1)) / 10.0, 1.0), 0) * 0.3
    )::float as popularity_score,
    -- Combined score with popularity boost
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
    -- Which embedding had the strongest match
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
    -- Only include titles where at least one embedding exceeds threshold
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

COMMENT ON FUNCTION match_titles_multi IS
'Performs weighted multi-embedding semantic search on titles with popularity boosting.
Blends three embedding types (content, vibe, metadata) with configurable weights.
Includes popularity boost based on vote_average (70%) and vote_count (30%).
Default weights: content=40%, vibe=35%, metadata=25%, popularity=10% (90% semantic + 10% popularity)
Returns titles ranked by combined similarity + quality score with individual score breakdowns.';

COMMIT;

-- Verification query (run after migration)
-- SELECT
--   title,
--   vote_average,
--   vote_count,
--   combined_score,
--   popularity_score
-- FROM match_titles_multi(
--   '[...]'::vector(768),
--   '[...]'::vector(768),
--   '[...]'::vector(768),
--   0.40, 0.35, 0.25, 0.10,
--   0.3, 20
-- )
-- ORDER BY combined_score DESC;
