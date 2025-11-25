-- Migration: Fix search vector trigger for JSONB vibes
-- Applied: 2025-11-25
-- 
-- The vibes column was changed from text[] to JSONB to store scored objects.
-- This updates the search vector trigger to extract vibe names from JSONB.

CREATE OR REPLACE FUNCTION public.titles_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.original_title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.overview, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.profile_string, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.tagline, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.themes, ' '), '')), 'B') ||
    -- Handle JSONB vibes: extract keys (vibe names) where score >= 0.3
    setweight(to_tsvector('english', COALESCE(
      (SELECT string_agg(key, ' ') FROM jsonb_each_text(NEW.vibes) WHERE value::numeric >= 0.3),
      ''
    )), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.keywords, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.genres, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.director, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.writers, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.creators, ' '), '')), 'B');

  RETURN NEW;
END;
$function$;

