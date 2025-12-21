-- Migration: Add find_similar_to_title function
-- Date: 2025-12-21
-- Purpose: Enable "something like Klaus" queries by using a reference title's embeddings
-- Strategy: Look up title by name, use its embeddings to find similar titles

BEGIN;

-- Function to find titles similar to a given title name
-- Uses the reference title's actual embeddings for accurate similarity matching
CREATE OR REPLACE FUNCTION find_similar_to_title (
  reference_title TEXT,
  weight_content FLOAT DEFAULT 0.40,
  weight_vibe FLOAT DEFAULT 0.35,
  weight_metadata FLOAT DEFAULT 0.25,
  weight_popularity FLOAT DEFAULT 0.10,
  match_count INT DEFAULT 10,
  exclude_same_collection BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id BIGINT,
  title TEXT,
  kind TEXT,
  release_date DATE,
  overview TEXT,
  genres TEXT[],
  director TEXT,
  vibes JSONB,
  themes TEXT[],
  runtime_minutes INT,
  vote_average NUMERIC,
  certification TEXT,
  profile_string TEXT,
  content_score FLOAT,
  vibe_score FLOAT,
  metadata_score FLOAT,
  popularity_score FLOAT,
  combined_score FLOAT,
  strongest_signal TEXT,
  reference_title_id BIGINT,
  reference_title_name TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  ref_id BIGINT;
  ref_title TEXT;
  ref_collection TEXT;
  ref_content_embedding vector(1536);
  ref_vibe_embedding vector(1536);
  ref_metadata_embedding vector(1536);
  semantic_weight FLOAT;
BEGIN
  -- Calculate semantic weight (remaining after popularity boost)
  semantic_weight := 1.0 - weight_popularity;

  -- Find the reference title (case-insensitive, prefer exact match, then starts-with, then contains)
  SELECT
    t.id,
    t.title,
    t.collection_name,
    t.content_embedding,
    t.vibe_embedding,
    t.metadata_embedding
  INTO
    ref_id,
    ref_title,
    ref_collection,
    ref_content_embedding,
    ref_vibe_embedding,
    ref_metadata_embedding
  FROM titles t
  WHERE
    t.content_embedding IS NOT NULL AND
    t.vibe_embedding IS NOT NULL AND
    t.metadata_embedding IS NOT NULL AND
    (
      LOWER(t.title) = LOWER(reference_title) OR
      LOWER(t.original_title) = LOWER(reference_title)
    )
  ORDER BY
    -- Prefer exact matches
    CASE WHEN LOWER(t.title) = LOWER(reference_title) THEN 0 ELSE 1 END,
    -- Then by popularity
    t.vote_count DESC NULLS LAST
  LIMIT 1;

  -- If no exact match, try fuzzy match (starts with or contains)
  IF ref_id IS NULL THEN
    SELECT
      t.id,
      t.title,
      t.collection_name,
      t.content_embedding,
      t.vibe_embedding,
      t.metadata_embedding
    INTO
      ref_id,
      ref_title,
      ref_collection,
      ref_content_embedding,
      ref_vibe_embedding,
      ref_metadata_embedding
    FROM titles t
    WHERE
      t.content_embedding IS NOT NULL AND
      t.vibe_embedding IS NOT NULL AND
      t.metadata_embedding IS NOT NULL AND
      (
        LOWER(t.title) LIKE LOWER(reference_title) || '%' OR
        LOWER(t.title) LIKE '%' || LOWER(reference_title) || '%' OR
        LOWER(t.original_title) LIKE LOWER(reference_title) || '%' OR
        LOWER(t.original_title) LIKE '%' || LOWER(reference_title) || '%'
      )
    ORDER BY
      -- Prefer starts-with over contains
      CASE
        WHEN LOWER(t.title) LIKE LOWER(reference_title) || '%' THEN 0
        WHEN LOWER(t.original_title) LIKE LOWER(reference_title) || '%' THEN 1
        ELSE 2
      END,
      -- Prefer shorter titles (more likely to be the intended match)
      LENGTH(t.title),
      -- Then by popularity
      t.vote_count DESC NULLS LAST
    LIMIT 1;
  END IF;

  -- If still no match found, return empty result
  IF ref_id IS NULL THEN
    RETURN;
  END IF;

  -- Find similar titles using the reference title's embeddings
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
    t.profile_string,
    -- Individual similarity scores (0-1, higher is better)
    (1 - (t.content_embedding <=> ref_content_embedding))::FLOAT as content_score,
    (1 - (t.vibe_embedding <=> ref_vibe_embedding))::FLOAT as vibe_score,
    (1 - (t.metadata_embedding <=> ref_metadata_embedding))::FLOAT as metadata_score,
    -- Popularity score (0-1, blending vote_average + vote_count)
    (
      COALESCE(LEAST(t.vote_average / 10.0, 1.0), 0) * 0.7 +
      COALESCE(LEAST(LOG(GREATEST(t.vote_count, 1)) / 10.0, 1.0), 0) * 0.3
    )::FLOAT as popularity_score,
    -- Combined score with popularity boost
    (
      (
        weight_content * (1 - (t.content_embedding <=> ref_content_embedding)) +
        weight_vibe * (1 - (t.vibe_embedding <=> ref_vibe_embedding)) +
        weight_metadata * (1 - (t.metadata_embedding <=> ref_metadata_embedding))
      ) * semantic_weight +
      (
        COALESCE(LEAST(t.vote_average / 10.0, 1.0), 0) * 0.7 +
        COALESCE(LEAST(LOG(GREATEST(t.vote_count, 1)) / 10.0, 1.0), 0) * 0.3
      ) * weight_popularity
    )::FLOAT as combined_score,
    -- Which embedding had the strongest match
    CASE
      WHEN (1 - (t.content_embedding <=> ref_content_embedding)) >=
           GREATEST((1 - (t.vibe_embedding <=> ref_vibe_embedding)),
                   (1 - (t.metadata_embedding <=> ref_metadata_embedding)))
      THEN 'content'
      WHEN (1 - (t.vibe_embedding <=> ref_vibe_embedding)) >=
           (1 - (t.metadata_embedding <=> ref_metadata_embedding))
      THEN 'vibe'
      ELSE 'metadata'
    END as strongest_signal,
    -- Include reference info for debugging/display
    ref_id as reference_title_id,
    ref_title as reference_title_name
  FROM titles t
  WHERE
    -- Exclude the reference title itself
    t.id != ref_id AND
    -- Only include titles with embeddings
    t.content_embedding IS NOT NULL AND
    t.vibe_embedding IS NOT NULL AND
    t.metadata_embedding IS NOT NULL AND
    -- Optionally exclude same collection (e.g., don't recommend other Klaus if asking for Klaus-like)
    (NOT exclude_same_collection OR ref_collection IS NULL OR t.collection_name IS NULL OR t.collection_name != ref_collection)
  ORDER BY combined_score DESC
  LIMIT LEAST(match_count, 200);
END;
$$;

COMMENT ON FUNCTION find_similar_to_title IS
'Finds titles similar to a given reference title by name.
Uses the reference title''s actual embeddings (content, vibe, metadata) for accurate similarity matching.
Handles fuzzy matching: exact match > starts-with > contains, preferring more popular titles.
Default weights: content=40%, vibe=35%, metadata=25%, popularity=10% (90% semantic + 10% popularity).
Example: SELECT * FROM find_similar_to_title(''Klaus'') returns movies similar to Klaus.
Set exclude_same_collection=true to avoid recommending sequels/franchise entries.';

-- Simpler function that works by ID (for when the application has already resolved the title)
-- More efficient and avoids title matching ambiguity
CREATE OR REPLACE FUNCTION find_similar_to_title_by_id (
  reference_title_id BIGINT,
  weight_content FLOAT DEFAULT 0.40,
  weight_vibe FLOAT DEFAULT 0.35,
  weight_metadata FLOAT DEFAULT 0.25,
  weight_popularity FLOAT DEFAULT 0.10,
  match_count INT DEFAULT 10,
  exclude_same_collection BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id BIGINT,
  title TEXT,
  kind TEXT,
  release_date DATE,
  overview TEXT,
  genres TEXT[],
  director TEXT,
  vibes JSONB,
  themes TEXT[],
  runtime_minutes INT,
  vote_average NUMERIC,
  certification TEXT,
  profile_string TEXT,
  content_score FLOAT,
  vibe_score FLOAT,
  metadata_score FLOAT,
  popularity_score FLOAT,
  combined_score FLOAT,
  strongest_signal TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  ref_collection TEXT;
  ref_content_embedding vector(1536);
  ref_vibe_embedding vector(1536);
  ref_metadata_embedding vector(1536);
  semantic_weight FLOAT;
BEGIN
  -- Calculate semantic weight
  semantic_weight := 1.0 - weight_popularity;

  -- Get reference title's embeddings
  SELECT
    t.collection_name,
    t.content_embedding,
    t.vibe_embedding,
    t.metadata_embedding
  INTO
    ref_collection,
    ref_content_embedding,
    ref_vibe_embedding,
    ref_metadata_embedding
  FROM titles t
  WHERE t.id = reference_title_id;

  -- If title not found or missing embeddings, return empty
  IF ref_content_embedding IS NULL OR ref_vibe_embedding IS NULL OR ref_metadata_embedding IS NULL THEN
    RETURN;
  END IF;

  -- Find similar titles
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
    t.profile_string,
    (1 - (t.content_embedding <=> ref_content_embedding))::FLOAT as content_score,
    (1 - (t.vibe_embedding <=> ref_vibe_embedding))::FLOAT as vibe_score,
    (1 - (t.metadata_embedding <=> ref_metadata_embedding))::FLOAT as metadata_score,
    (
      COALESCE(LEAST(t.vote_average / 10.0, 1.0), 0) * 0.7 +
      COALESCE(LEAST(LOG(GREATEST(t.vote_count, 1)) / 10.0, 1.0), 0) * 0.3
    )::FLOAT as popularity_score,
    (
      (
        weight_content * (1 - (t.content_embedding <=> ref_content_embedding)) +
        weight_vibe * (1 - (t.vibe_embedding <=> ref_vibe_embedding)) +
        weight_metadata * (1 - (t.metadata_embedding <=> ref_metadata_embedding))
      ) * semantic_weight +
      (
        COALESCE(LEAST(t.vote_average / 10.0, 1.0), 0) * 0.7 +
        COALESCE(LEAST(LOG(GREATEST(t.vote_count, 1)) / 10.0, 1.0), 0) * 0.3
      ) * weight_popularity
    )::FLOAT as combined_score,
    CASE
      WHEN (1 - (t.content_embedding <=> ref_content_embedding)) >=
           GREATEST((1 - (t.vibe_embedding <=> ref_vibe_embedding)),
                   (1 - (t.metadata_embedding <=> ref_metadata_embedding)))
      THEN 'content'
      WHEN (1 - (t.vibe_embedding <=> ref_vibe_embedding)) >=
           (1 - (t.metadata_embedding <=> ref_metadata_embedding))
      THEN 'vibe'
      ELSE 'metadata'
    END as strongest_signal
  FROM titles t
  WHERE
    t.id != reference_title_id AND
    t.content_embedding IS NOT NULL AND
    t.vibe_embedding IS NOT NULL AND
    t.metadata_embedding IS NOT NULL AND
    (NOT exclude_same_collection OR ref_collection IS NULL OR t.collection_name IS NULL OR t.collection_name != ref_collection)
  ORDER BY combined_score DESC
  LIMIT LEAST(match_count, 200);
END;
$$;

COMMENT ON FUNCTION find_similar_to_title_by_id IS
'Finds titles similar to a reference title by ID.
More efficient than find_similar_to_title when the title ID is already known.
Uses the reference title''s embeddings for accurate similarity matching.
Example: SELECT * FROM find_similar_to_title_by_id(12345) returns movies similar to title ID 12345.';

COMMIT;

-- Verification queries (run after migration)

-- Test 1: Find movies similar to Klaus
-- SELECT title, genres, combined_score, strongest_signal, reference_title_name
-- FROM find_similar_to_title('Klaus', 0.40, 0.35, 0.25, 0.10, 10)
-- ORDER BY combined_score DESC;

-- Test 2: Test fuzzy matching
-- SELECT title, reference_title_name FROM find_similar_to_title('dark knight', match_count := 5);

-- Test 3: Exclude same collection
-- SELECT title, reference_title_name FROM find_similar_to_title('The Godfather', exclude_same_collection := true);
