# Vector Embeddings Integration

This project now includes automatic generation of vector embeddings for all movie and TV titles using OpenAI's `text-embedding-3-small` model.

## Overview

Vector embeddings enable semantic search on your titles database. The embeddings combine title, overview, genres, languages, and other metadata to create rich 1536-dimensional vectors that capture the meaning and context of each title.

## Setup

### 1. Install Dependencies

```bash
npm install
```

This installs the OpenAI SDK along with other dependencies.

### 2. Configure OpenAI API Key

Add your OpenAI API key to `.env`:

```bash
OPENAI_API_KEY=sk-proj-your-api-key-here
```

**Note**: You can get an API key from [OpenAI Platform](https://platform.openai.com/api-keys)

### 3. Database Schema

Your database already has the correct schema with `embedding vector(1536)` column in the `titles` table.

## Usage

### Ingest New Titles (with automatic embeddings)

The standard ingestion process now automatically generates embeddings:

```bash
npm run ingest
```

This will:
1. Fetch movies/TV shows from TMDB
2. Normalize the data
3. **Generate embeddings for each batch** (NEW)
4. Upsert to Supabase with embeddings

### Backfill Embeddings for Existing Titles

If you have existing titles without embeddings (like your current 40 titles):

```bash
npm run backfill
```

This will:
1. Fetch all titles from the database that don't have embeddings
2. Generate embeddings in batches of 100
3. Update the database with the new embeddings
4. Show progress and statistics

**Optional**: Regenerate ALL embeddings (including existing ones):

```bash
node generate-embeddings-backfill.js --regenerate-all
```

⚠️ **Warning**: This will regenerate embeddings for all titles and cost more API credits.

## How It Works

### Embedding Text Format

Each title is converted to structured text before embedding:

```
Title: The Matrix
Original Title: The Matrix
Overview: A computer hacker learns from mysterious rebels...
Genres: Action, Science Fiction
Languages: en
Type: movie
Release Date: 1999-03-30
Rating: 8.2/10
Popularity: 123.45
Runtime: 136 minutes
```

### Cost Optimization

- **Model**: `text-embedding-3-small` (cheapest, 1536 dimensions)
- **Batch Processing**: Up to 2048 titles per API call
- **Price**: ~$0.02 per 1 million tokens
- **Estimated cost per title**: ~$0.00002 (2/100,000th of a cent)

### Example Costs

- 40 titles: < $0.001 (less than 1/10th of a penny)
- 100 titles: ~$0.002 (about 1/5th of a penny)
- 1,000 titles: ~$0.02 (2 cents)
- 10,000 titles: ~$0.20 (20 cents)

## File Structure

```
DBSetup/
├── embeddings.js                       # Core embedding logic (NEW)
├── generate-embeddings-backfill.js     # Backfill script (NEW)
├── injest.js                           # Updated with embedding generation
├── supabase-upsert.js                  # Updated to handle embeddings
├── tmdb.js                             # TMDB API client (unchanged)
├── .env                                # API keys (OPENAI_API_KEY added)
└── package.json                        # Updated with openai dependency
```

## API Reference

### `embeddings.js`

#### `generateEmbeddingText(title)`
Converts a title object into formatted text for embedding.

**Parameters:**
- `title` (Object): Normalized title object

**Returns:** String - Formatted text

#### `generateEmbeddings(titles)`
Generates embeddings for a batch of titles using OpenAI API.

**Parameters:**
- `titles` (Array): Array of normalized title objects (max 2048)

**Returns:** Promise<Array> - Array of embedding vectors (1536 dimensions each)

**Features:**
- Automatic batching for large arrays
- Error handling with graceful fallbacks
- Progress logging

#### `generateEmbeddingsWithRetry(titles, maxRetries)`
Generates embeddings with automatic retry logic.

**Parameters:**
- `titles` (Array): Array of normalized title objects
- `maxRetries` (Number): Maximum retry attempts (default: 3)

**Returns:** Promise<Array> - Array of embedding vectors

**Features:**
- Exponential backoff between retries
- Detailed error logging

### `supabase-upsert.js`

#### `batchUpsertTitles(titles, embeddings)`
Upserts titles to Supabase with optional embeddings.

**Parameters:**
- `titles` (Array): Array of normalized title objects
- `embeddings` (Array, optional): Array of embedding vectors

**Returns:** Promise<Object> - `{success: number, failed: number, errors: Array}`

## Querying with Vector Similarity

Once embeddings are generated, you can perform semantic search using Supabase's vector operations.

### Example: Find Similar Titles

```sql
-- First, generate an embedding for your search query
-- (use the same OpenAI model in your application)

-- Then search for similar titles using cosine distance
SELECT 
  id,
  title,
  overview,
  1 - (embedding <=> query_embedding) as similarity
FROM titles
WHERE embedding IS NOT NULL
ORDER BY embedding <=> query_embedding
LIMIT 10;
```

### Example: Using Supabase Client

```javascript
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

async function semanticSearch(query, limit = 10) {
  // Generate embedding for search query
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  })
  
  const queryEmbedding = response.data[0].embedding
  
  // Search database using RPC function
  const { data, error } = await supabase.rpc('match_titles', {
    query_embedding: queryEmbedding,
    match_threshold: 0.5,
    match_count: limit
  })
  
  return data
}
```

### Create Matching Function in Supabase

Run this SQL in Supabase to create a matching function:

```sql
CREATE OR REPLACE FUNCTION match_titles (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id bigint,
  title text,
  overview text,
  similarity float
)
LANGUAGE sql
AS $$
  SELECT
    id,
    title,
    overview,
    1 - (embedding <=> query_embedding) as similarity
  FROM titles
  WHERE embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT least(match_count, 200);
$$;
```

## Troubleshooting

### "You exceeded your current quota" Error

This means your OpenAI API key has no credits or exceeded its quota. Solutions:
1. Add credits to your OpenAI account at [platform.openai.com/account/billing](https://platform.openai.com/account/billing)
2. Create a new API key with an active billing plan
3. Check your usage limits at [platform.openai.com/usage](https://platform.openai.com/usage)

### Embeddings are NULL in database

If embeddings are showing as NULL:
1. Check that `OPENAI_API_KEY` is set in `.env`
2. Check console logs for error messages during ingestion
3. Run the backfill script manually: `npm run backfill`
4. Verify your OpenAI API key has sufficient credits

### Slow Performance

If embedding generation is slow:
1. Check your internet connection
2. Verify OpenAI API status at [status.openai.com](https://status.openai.com)
3. Reduce `BATCH_SIZE` in the scripts if you're hitting rate limits

### Rate Limiting

OpenAI has rate limits based on your tier:
- **Free tier**: 3 requests/minute, 200 requests/day
- **Tier 1**: 500 requests/minute
- **Tier 2+**: Higher limits

If you hit rate limits, the backfill script will handle it gracefully and continue processing.

## Advanced Configuration

### Using Different Embedding Models

To use `text-embedding-3-large` instead (3072 dimensions, better quality):

1. Update `embeddings.js`:
```javascript
model: "text-embedding-3-large"  // Change from text-embedding-3-small
```

2. Update database schema:
```sql
ALTER TABLE titles ALTER COLUMN embedding TYPE vector(3072);
```

3. Regenerate all embeddings:
```bash
node generate-embeddings-backfill.js --regenerate-all
```

### Custom Embedding Text

Modify `generateEmbeddingText()` in `embeddings.js` to customize what metadata is included in embeddings.

## Best Practices

1. **Always generate embeddings during ingestion** - The workflow is optimized for this
2. **Use backfill script for existing data** - Don't try to regenerate all embeddings manually
3. **Monitor costs** - Check OpenAI usage dashboard regularly
4. **Test searches** - Verify embedding quality with sample searches
5. **Create indexes** - Add vector indexes for faster similarity searches on large datasets

## Performance Tips

- **Batch size**: Default is 20 for ingestion, 100 for backfill (optimal for cost/speed)
- **Vector indexes**: Create HNSW or IVFFlat indexes for faster searches
- **Caching**: Cache embeddings for frequently searched queries
- **Partial updates**: Only regenerate embeddings when content changes significantly

## License

Same as parent project.
