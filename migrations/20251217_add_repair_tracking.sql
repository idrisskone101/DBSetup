-- TMDB repair tracking
ALTER TABLE titles ADD COLUMN IF NOT EXISTS tmdb_repair_status TEXT
  CHECK (tmdb_repair_status IN ('pending', 'success', 'not_found', 'api_error', 'no_data'));
ALTER TABLE titles ADD COLUMN IF NOT EXISTS tmdb_repair_attempted_at TIMESTAMPTZ;
ALTER TABLE titles ADD COLUMN IF NOT EXISTS tmdb_repair_error TEXT;

-- Enrichment repair tracking
ALTER TABLE titles ADD COLUMN IF NOT EXISTS enrichment_repair_status TEXT
  CHECK (enrichment_repair_status IN ('pending', 'success', 'partial', 'wiki_not_found', 'llm_error', 'validation_failed'));
ALTER TABLE titles ADD COLUMN IF NOT EXISTS enrichment_repair_attempted_at TIMESTAMPTZ;
ALTER TABLE titles ADD COLUMN IF NOT EXISTS enrichment_repair_error TEXT;

-- Indexes for repair queue queries
CREATE INDEX IF NOT EXISTS idx_tmdb_repair_queue
  ON titles(tmdb_repair_status)
  WHERE overview IS NULL OR tmdb_repair_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_enrichment_repair_queue
  ON titles(enrichment_repair_status)
  WHERE enrichment_status = 'enriched'
    AND (enrichment_repair_status IS NULL OR enrichment_repair_status = 'pending');
