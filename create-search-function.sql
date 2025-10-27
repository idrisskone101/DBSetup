-- Create a function for semantic search on titles using vector embeddings
-- This allows you to search for similar movies/TV shows based on meaning

CREATE OR REPLACE FUNCTION match_titles (
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id bigint,
  title text,
  overview text,
  kind text,
  genres text[],
  vote_average numeric,
  similarity float
)
LANGUAGE sql
AS $$
  SELECT
    id,
    title,
    overview,
    kind,
    genres,
    vote_average,
    1 - (embedding <=> query_embedding) as similarity
  FROM titles
  WHERE embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT least(match_count, 200);
$$;

-- Example usage (you'll need to generate the query_embedding in your app):
--
-- SELECT * FROM match_titles(
--   '[0.1, 0.2, 0.3, ...]'::vector(1536),  -- Your query embedding
--   0.5,  -- Minimum similarity threshold (0-1)
--   10    -- Number of results
-- );

-- Create an HNSW index for faster similarity search (optional but recommended)
-- This significantly speeds up queries on large datasets
CREATE INDEX IF NOT EXISTS titles_embedding_idx
ON titles
USING hnsw (embedding vector_cosine_ops);

-- Note: The index creation may take a few seconds with 40 titles,
-- but will be much faster for searches once created.
