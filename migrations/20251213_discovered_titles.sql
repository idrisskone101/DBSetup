-- Staging table for discovered titles from TMDB
-- Titles are first discovered here, then ingested into the main titles table

CREATE TABLE IF NOT EXISTS discovered_titles (
  id BIGINT PRIMARY KEY,           -- TMDB ID
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'tv')),
  title TEXT NOT NULL,
  original_title TEXT,
  overview TEXT,
  release_date DATE,
  popularity NUMERIC,
  vote_average NUMERIC,
  vote_count INTEGER,
  poster_path TEXT,
  backdrop_path TEXT,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  discovery_source TEXT,            -- 'popular', 'genre:action', 'year:2024', etc.
  ingestion_status TEXT DEFAULT 'pending'
    CHECK (ingestion_status IN ('pending', 'ingested', 'failed', 'skipped')),
  ingested_at TIMESTAMPTZ,
  error_message TEXT
);

-- Index for efficient querying of pending titles ordered by popularity
CREATE INDEX IF NOT EXISTS idx_discovered_pending
  ON discovered_titles(ingestion_status, popularity DESC)
  WHERE ingestion_status = 'pending';

-- Index for filtering by kind
CREATE INDEX IF NOT EXISTS idx_discovered_kind
  ON discovered_titles(kind, ingestion_status);

-- Add discovery tracking columns to titles table if not exist
ALTER TABLE titles ADD COLUMN IF NOT EXISTS discovery_source TEXT;
ALTER TABLE titles ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;

-- Disable RLS on discovered_titles for pipeline access
ALTER TABLE discovered_titles DISABLE ROW LEVEL SECURITY;
