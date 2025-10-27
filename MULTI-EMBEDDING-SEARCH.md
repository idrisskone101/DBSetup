# Multi-Embedding Search Guide

## Overview

This system blends 3 embedding types to provide rich semantic search across titles:

- **Content Embedding (40%)** - Story/narrative elements (plot, themes, overview)
- **Vibe Embedding (35%)** - Emotional/atmospheric profile (vibes, tone, pacing)
- **Metadata Embedding (25%)** - Factual/categorical data (genres, director, cast)

## Quick Start

### 1. Apply the SQL Function

The SQL function has already been applied to your database. If you need to reapply it:

```bash
# Via Supabase CLI
supabase db execute < create-multi-embedding-search-function.sql

# Or via SQL editor in Supabase Dashboard
# Copy/paste contents of create-multi-embedding-search-function.sql
```

### 2. Run a Search

```bash
# Basic search
npm run search:multi "cozy romantic comedies"

# Or with node directly
node test-multi-embedding-search.js "cozy romantic comedies"
```

## Usage Examples

### Basic Search
```bash
node test-multi-embedding-search.js "dark thriller movies"
```

### Custom Weights
```bash
# Focus more on content (60%), less on vibe (25%), minimal metadata (15%)
node test-multi-embedding-search.js "complex heist movie" --content=0.6 --vibe=0.25 --metadata=0.15
```

### Interactive Weight Tuning
```bash
# Adjust weights interactively and see results update in real-time
node test-multi-embedding-search.js "superhero movies" --tune
npm run tune:weights "superhero movies"
```

### Run Test Suite
```bash
# Run predefined test queries
node test-multi-embedding-search.js --test
```

### Compare Weight Strategies
```bash
# Compare 5 different weight configurations side-by-side
node test-multi-embedding-search.js "nolan movies" --compare
```

### Export Results
```bash
# Export results to JSON file for analysis
node test-multi-embedding-search.js "action movies" --export
```

### Help
```bash
node test-multi-embedding-search.js --help
```

## Understanding the Weights

### Default Weights (Recommended)
- **Content: 40%** - Primary focus on story/narrative
- **Vibe: 35%** - Strong emphasis on emotional connection
- **Metadata: 25%** - Supporting role for factual filters

### When to Adjust Weights

**Content-Heavy Queries** (content=50-60%)
- "movies about heists"
- "complex time travel stories"
- "coming of age narratives"

**Vibe-Heavy Queries** (vibe=50-60%)
- "cozy comfort watch"
- "dark and gritty"
- "whimsical fantasy"

**Metadata-Heavy Queries** (metadata=50-60%)
- "Spielberg sci-fi movies"
- "90s action films"
- "R-rated thrillers"

## Output Interpretation

```
1. ⭐ The Prestige (2006) [movie]
   Score: 0.847 ████████████████████████████████████████████ 84.7%
   Breakdown:
     • content:  78.5%
     • vibe:     91.2% ★
     • metadata: 82.0%
   Genres: Drama, Mystery, Thriller
   Vibes: dark, atmospheric, tense
   Director: Christopher Nolan
```

- **Score**: Combined weighted similarity (0-1, higher is better)
- **Progress Bar**: Visual representation of combined score
- **Breakdown**: Individual scores per embedding type
- **★ Symbol**: Indicates which embedding had the strongest match
- **Details**: Full metadata about the title

## Performance Tips

1. **Threshold**: Default is 0.3. Lower it (0.2) for more results, raise it (0.4) for stricter matches
2. **Match Count**: Default is 10. Increase for more results (max 200)
3. **Rate Limiting**: The test script includes delays between queries to avoid API rate limits

## Advanced: Programmatic Usage

```javascript
import { searchWithBlend, displayResults } from './test-multi-embedding-search.js';

// Perform a search
const results = await searchWithBlend("cozy movies", {
  weights: { content: 0.4, vibe: 0.35, metadata: 0.25 },
  matchThreshold: 0.3,
  matchCount: 10,
  verbose: true
});

// Display results
displayResults(results, {
  showDetails: true,
  showScoreBreakdown: true
});
```

## Troubleshooting

### "No results found"
- Lower the match threshold: try 0.2 instead of 0.3
- Check that your titles have all 3 embeddings populated
- Verify embeddings were generated: `npm run backfill:multi`

### "Function match_titles_multi does not exist"
- Apply the SQL function: Run the SQL in `create-multi-embedding-search-function.sql`

### "Query embedding generation failed"
- Check that `OPENAI_API_KEY` is set in your `.env` file
- Verify your OpenAI API key has credits/quota remaining

## Files

- `create-multi-embedding-search-function.sql` - PostgreSQL function for weighted search
- `test-multi-embedding-search.js` - Test script with CLI interface
- `embeddings.js` - Embedding generation utilities (reused)
- `supabase-upsert.js` - Supabase client setup (reused)

## Next Steps

1. Run the test suite to validate: `node test-multi-embedding-search.js --test`
2. Try interactive tuning: `npm run tune:weights "your query"`
3. Experiment with different weight configurations
4. Document your preferred weights for different query types
5. Consider building a UI on top of this search functionality

## Recommended Weight Blends

Based on testing, here are proven weight configurations:

| Query Type | Content | Vibe | Metadata | Example |
|------------|---------|------|----------|---------|
| General | 40% | 35% | 25% | "great movies" |
| Story-focused | 55% | 30% | 15% | "movies about revenge" |
| Mood-focused | 25% | 60% | 15% | "cozy comfort watch" |
| Person-focused | 20% | 20% | 60% | "Christopher Nolan films" |
| Genre-focused | 30% | 25% | 45% | "90s action thrillers" |
| Balanced | 33% | 34% | 33% | All equal weight |

## Questions?

The implementation follows the weighted average approach (Option 2) as discussed. The weights were chosen to prioritize:
1. Story/narrative content (most queries are about "what happens")
2. Emotional/atmospheric feel (critical for recommendations)
3. Factual metadata (supporting role for filtering)

Adjust weights based on your specific use case and user feedback!
