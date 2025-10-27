-- Create a function for multi-embedding semantic search on titles
-- This allows weighted blending of 3 embedding types: vibe, content, metadata
-- Each embedding captures different aspects of titles for rich semantic search

CREATE OR REPLACE FUNCTION match_titles_multi (
  query_content_embedding vector(1536),
  query_vibe_embedding vector(1536),
  query_metadata_embedding vector(1536),
  weight_content float DEFAULT 0.40,
  weight_vibe float DEFAULT 0.35,
  weight_metadata float DEFAULT 0.25,
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
  combined_score float,
  strongest_signal text
)
LANGUAGE plpgsql
AS $$
BEGIN
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
    -- Weighted combination score
    (
      weight_content * (1 - (t.content_embedding <=> query_content_embedding)) +
      weight_vibe * (1 - (t.vibe_embedding <=> query_vibe_embedding)) +
      weight_metadata * (1 - (t.metadata_embedding <=> query_metadata_embedding))
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

-- Example usage:
--
-- SELECT * FROM match_titles_multi(
--   '[0.1, 0.2, ...]'::vector(1536),  -- content embedding
--   '[0.1, 0.2, ...]'::vector(1536),  -- vibe embedding
--   '[0.1, 0.2, ...]'::vector(1536),  -- metadata embedding
--   0.40,  -- content weight (40%)
--   0.35,  -- vibe weight (35%)
--   0.25,  -- metadata weight (25%)
--   0.3,   -- minimum similarity threshold
--   10     -- max results
-- );

COMMENT ON FUNCTION match_titles_multi IS
'Performs weighted multi-embedding semantic search on titles.
Blends three embedding types (content, vibe, metadata) with configurable weights.
Returns titles ranked by combined similarity score with individual score breakdowns.
Default weights: content=40%, vibe=35%, metadata=25%';
