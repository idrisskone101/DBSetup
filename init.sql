CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS titles (
  id BIGINT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'movie',
  title TEXT NOT NULL,
  overview TEXT,
  release_date DATE,
  popularity NUMERIC,
  vote_average NUMERIC(3,1),
  genres TEXT[],
  runtime_minutes INT,
  poster_path TEXT,
  payload JSONB,
  embedding vector(1536)
);
