-- Migration: Change vibes column from text[] to JSONB
-- Applied: 2025-11-25
-- 
-- This allows storing scored vibe objects like { "dark": 0.90, "cozy": 0.75 }
-- instead of simple text arrays. The scores range from 0.0 to 1.0 and
-- indicate how strongly each vibe applies to a title.

-- Drop old text[] column and recreate as JSONB
ALTER TABLE titles DROP COLUMN IF EXISTS vibes;
ALTER TABLE titles ADD COLUMN vibes JSONB;

-- Add comment explaining the new format
COMMENT ON COLUMN titles.vibes IS 'JSONB object of vibe scores: { "dark": 0.90, "cozy": 0.75, ... }. Scores range from 0.0 to 1.0.';

