# Data Canonicalization Report

**Date:** 2025-10-23  
**Database:** Supabase - titles table  
**Total Records:** ~1000

---

## Summary

Successfully canonicalized data across 5 columns in the `titles` table, applying lowercase normalization, semantic consolidation, and deduplication.

---

## Results Overview

| Column | Before | After | Change | Reduction % |
|--------|--------|-------|--------|-------------|
| **genres** | 27 | 25 | -2 | 7.4% |
| **vibes** | 1,491 | 1,481 | -10 | 0.7% |
| **themes** | 2,499 | 2,498 | -1 | 0.04% |
| **tone** | 213 | 207 | -6 | 2.8% |
| **pacing** | 16 | 16 | 0 | 0% |

---

## Detailed Changes by Column

### 1. Genres (Array Column)

**Transformations Applied:**
- ✅ All values normalized to lowercase
- ✅ Split compound genres into separate values
- ✅ Removed duplicates after splitting

**Specific Mappings:**
- `"Science Fiction"` → `"science fiction"`
- `"Sci-Fi & Fantasy"` → `["science fiction", "fantasy"]` (split)
- `"Action & Adventure"` → `["action", "adventure"]` (split)
- `"War & Politics"` → `["war", "politics"]` (split)

**Final Canonical Genres (25 total):**
```
action, adventure, animation, comedy, crime, documentary, drama, family, 
fantasy, history, horror, kids, music, mystery, news, politics, reality, 
romance, science fiction, soap, talk, thriller, tv movie, war, western
```

**Note:** Added new genre `politics` from splitting compound genres.

---

### 2. Vibes (Array Column)

**Transformations Applied:**
- ✅ Normalized hyphenation: `"light-hearted"` → `"lighthearted"`
- ✅ Consolidated dark comedy variations
- ✅ Normalized decade references: `"80s"` → `"1980s"`
- ✅ Fixed case variations (Gothic → gothic)
- ✅ All values normalized to lowercase
- ✅ Removed duplicates

**Specific Mappings:**
- `"light-hearted"` and all variations → `"lighthearted"`
- `"darkly comic"` → `"darkly comedic"`
- `"dark comedy"` → `"darkly comedic"`
- `"80s nostalgia"` → `"1980s nostalgia"`
- `"80s neo-noir"` → `"1980s neo-noir"`
- `"80s ski culture"` → `"1980s ski culture"`
- `"Gothic fantasy"` → `"gothic fantasy"`
- `"Gothic horror"` → `"gothic horror"`
- `"1930s Southern Gothic"` → `"1930s southern gothic"`

**Impact:**
- Reduced from 1,491 to 1,481 distinct values
- Primarily consolidated case variations and hyphenation inconsistencies

---

### 3. Themes (Array Column)

**Transformations Applied:**
- ✅ Standardized "coming of age" variations
- ✅ All values normalized to lowercase
- ✅ Removed duplicates

**Specific Mappings:**
- `"coming of age"` → `"coming-of-age"`

**Impact:**
- Reduced from 2,499 to 2,498 distinct values
- Minimal reduction due to moderate approach (preserved semantic variety)

---

### 4. Tone (String Column)

**Transformations Applied:**
- ✅ Normalized hyphenation: `"light-hearted"` → `"lighthearted"`
- ✅ Consolidated dark comedy variations
- ✅ All values normalized to lowercase

**Specific Mappings:**
- `"light-hearted"` and all variations → `"lighthearted"`
- `"darkly comic"` → `"darkly comedic"`

**Sample Canonical Tones:**
```
darkly comedic, lighthearted, dramatic, gritty, heroic, tense, suspenseful, 
whimsical, adventurous, cynical, earnest, etc.
```

**Impact:**
- Reduced from 213 to 207 distinct values
- 2.8% reduction through hyphenation standardization

---

### 5. Pacing (String Column)

**Transformations Applied:**
- ✅ All values normalized to lowercase

**Canonical Pacing Values (16 total):**
```
brisk, contemplative, conversational, dynamic, episodic, fast-paced, 
kinetic, methodical, mid, nonlinear, real-time, slow-burn, 
slow-burn with escalating tension, steady, varied, 
varied, with a mix of fast-paced segments and slower, reflective moments
```

**Impact:**
- No reduction in distinct values (already well-normalized)

---

## Implementation Details

### Approach
- **Consolidation Level:** Moderate (as requested)
- **Case Normalization:** All lowercase
- **Batch Processing:** Handled via SQL UPDATE statements
- **Array Operations:** Custom helper functions for splitting compound values

### SQL Functions Used
Created temporary helper functions:
- `array_replace()` - Replace single array element
- `array_replace_and_split()` - Replace and split compound array elements

Functions were dropped after canonicalization completed.

---

## Database Impact

### Performance
- All updates completed successfully
- No data loss occurred
- All array deduplication maintained data integrity

### Embedding Columns
**Note:** The following embedding columns were NOT regenerated:
- `content_embedding`
- `vibe_embedding`
- `metadata_embedding`

**Recommendation:** If embeddings are actively used for semantic search, consider regenerating them to reflect the canonicalized data.

---

## Validation Queries

To verify the canonicalization, run:

```sql
-- Check distinct counts
SELECT 
  'genres' as column_name,
  COUNT(DISTINCT genre) as distinct_count
FROM (SELECT unnest(genres) as genre FROM titles WHERE genres IS NOT NULL) sub;

-- Check for any remaining uppercase values
SELECT id, genres FROM titles 
WHERE EXISTS (
  SELECT 1 FROM unnest(genres) AS g 
  WHERE g != LOWER(g)
)
LIMIT 5;

-- Check for any remaining hyphenated "light-hearted"
SELECT id, vibes FROM titles 
WHERE EXISTS (
  SELECT 1 FROM unnest(vibes) AS v 
  WHERE v LIKE '%light-hearted%'
)
LIMIT 5;
```

---

## Files Created

1. **scripts/canonicalize-data.ts**
   - TypeScript implementation with Supabase client
   - Can be used for future canonicalization needs
   - Includes helper functions and batch processing logic

2. **migrations/canonicalize_data.sql**
   - Complete SQL migration script
   - Documented with step-by-step transformations
   - Includes verification queries

3. **CANONICALIZATION_REPORT.md** (this file)
   - Comprehensive documentation of changes
   - Before/after statistics
   - Validation queries

---

## Recommendations

### Future Data Entry
1. **Enforce lowercase at insertion** - Add database constraints or application-level validation
2. **Use canonical genre list** - Create an enum or reference table for genres
3. **Standardize compound values** - Document whether to split or keep combined (e.g., "Sci-Fi & Fantasy")

### Additional Cleanup Opportunities
Based on the data analysis, consider:

1. **Vibes** (1,481 distinct values)
   - Still very high - could benefit from more aggressive consolidation
   - Example: "action-packed comedy" could potentially map to both "action-packed" and "comedy" as separate values
   - Requires business decision on granularity vs. searchability

2. **Themes** (2,498 distinct values)
   - Extremely high variety - consider:
     - Creating a taxonomy of common themes
     - Using theme hierarchies (parent-child relationships)
     - Implementing a minimum threshold (remove themes appearing < 3 times)

3. **Compound Tones**
   - Many tones are compound (e.g., "tense and suspenseful")
   - Consider splitting into array column like vibes for better filtering

### Database Schema Improvements
```sql
-- Consider adding constraints
ALTER TABLE titles 
  ADD CONSTRAINT genres_lowercase 
  CHECK (genres = LOWER(genres::text)::text[]);

-- Consider creating reference tables
CREATE TABLE canonical_genres (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL CHECK (name = LOWER(name))
);
```

---

## Conclusion

✅ **Success:** All canonicalization tasks completed successfully across 1,000 records.

**Key Achievements:**
- Normalized all text to lowercase for consistency
- Split compound genre values for better filtering
- Consolidated hyphenation and spelling variations
- Maintained data integrity with no losses

**Next Steps:**
1. Consider regenerating embeddings if used for search
2. Implement validation at data entry to prevent future inconsistencies
3. Review high-variety columns (vibes, themes) for additional consolidation opportunities

---

*Report generated automatically after canonicalization process*
