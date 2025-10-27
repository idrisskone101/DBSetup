# TMDB to Supabase Ingestion with Vector Embeddings

This script fetches movie and TV show data from The Movie Database (TMDB) API and ingests it into your Supabase database with intelligent batching, rate limiting, and **automatic vector embeddings for semantic search**.

## Features

- **Vector Embeddings**: Automatic generation of OpenAI embeddings for semantic search
- **Batch Processing**: Upserts data in batches of 20 to reduce API calls to Supabase
- **Rate Limiting**: 400ms delay between TMDB API calls to respect rate limits
- **Progress Tracking**: Real-time progress indicators showing current/total items
- **Error Handling**: Skips failed items and continues processing
- **Detailed Logging**: Shows success/failure counts and duration
- **Semantic Search**: Find similar movies/TV shows based on meaning, not just keywords

## Prerequisites

1. **Supabase Project**: You need an active Supabase project with a `titles` table
2. **TMDB API Token**: Get your API token from [TMDB](https://www.themoviedb.org/settings/api)

## Environment Setup

Create a `.env` file with the following variables:

```bash
TMDB_TOKEN=your_tmdb_bearer_token_here
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
SUPABASE_ANON_KEY=your_supabase_anon_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

Get your OpenAI API key from [OpenAI Platform](https://platform.openai.com/api-keys).

## Installation

```bash
npm install
```

## Usage

### Ingest New Titles (with automatic embeddings)

```bash
npm run ingest
```

This will fetch titles from TMDB, generate vector embeddings, and store everything in Supabase.

### Backfill Embeddings for Existing Titles

If you have existing titles without embeddings:

```bash
npm run backfill
```

### Test Semantic Search

Search for similar titles using natural language:

```bash
npm run search "superhero action movie"
```

Or run example searches:

```bash
npm run search
```

## Configuration

### Batch Size

Edit `BATCH_SIZE` in `injest.js` (default: 20):

```javascript
const BATCH_SIZE = 20; // Adjust as needed
```

### Number of Pages

Edit the `main()` function in `injest.js`:

```javascript
async function main() {
  await ingestMovies(5); // Change this number (5 pages = ~100 movies)
  await ingestTv(5);     // Change this number (5 pages = ~100 TV shows)
}
```

### Rate Limiting

Edit the `gentle()` function for TMDB rate limiting:

```javascript
const gentle = async () => sleep(400); // 400ms delay
```

## Output Example

```
🚀 Starting TMDB → Supabase ingestion...

🎬 Starting movie ingestion (5 pages)...

[1/100] Fetched: Our Fault (1156594)
[2/100] Fetched: Inside Furioza (1072699)
...
✅ [20/100] Batch inserted 20 movies
...

🎬 Movies Summary: ✅ 98 inserted, ⚠️ 2 failed

📺 Starting TV show ingestion (5 pages)...
...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ INGESTION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Successfully inserted: 196 titles
⚠️ Failed/Skipped: 4 titles
⏱️ Duration: 124.53s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Database Schema

The `titles` table should have the following structure:

```sql
CREATE TABLE titles (
  id BIGINT PRIMARY KEY,
  kind TEXT CHECK (kind IN ('movie', 'tv')),
  imdb_id TEXT,
  title TEXT NOT NULL,
  original_title TEXT,
  overview TEXT,
  release_date DATE,
  runtime_minutes INTEGER,
  poster_path TEXT,
  backdrop_path TEXT,
  vote_average NUMERIC,
  vote_count INTEGER,
  popularity NUMERIC,
  genres TEXT[],
  languages TEXT[],
  providers JSONB,
  payload JSONB,
  embedding VECTOR,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Files

- `injest.js`: Main ingestion script with batching and progress tracking
- `supabase-upsert.js`: Supabase client and batch upsert logic
- `tmdb.js`: TMDB API client and data normalization
- `embeddings.js`: OpenAI vector embedding generation (NEW)
- `generate-embeddings-backfill.js`: Backfill script for existing titles (NEW)
- `test-semantic-search.js`: Demo script for semantic search (NEW)
- `create-search-function.sql`: SQL function for similarity search (NEW)
- `.env`: Environment variables (not committed to git)
- `EMBEDDINGS.md`: Detailed documentation for vector embeddings (NEW)

## Troubleshooting

### "SUPABASE_ANON_KEY not found"
Make sure you've added the `SUPABASE_ANON_KEY` to your `.env` file. Get it from your Supabase dashboard.

### Rate Limit Errors from TMDB
Increase the delay in the `gentle()` function (e.g., from 400ms to 500ms).

### Batch Insert Failures
Try reducing the `BATCH_SIZE` if you're hitting Supabase limits.

## Performance

- **Batch Size**: 20 titles per batch reduces Supabase API calls by ~95%
- **Rate Limiting**: 400ms delay between TMDB calls prevents rate limiting
- **Duration**: ~200 titles takes approximately 2-3 minutes

## Vector Embeddings & Semantic Search

This project now includes automatic vector embeddings using OpenAI's `text-embedding-3-small` model. This enables semantic search - finding similar titles based on meaning rather than exact keyword matches.

### How It Works

1. **During Ingestion**: Each title is automatically converted to a 1536-dimensional embedding
2. **Embedding Content**: Combines title, overview, genres, languages, ratings, and metadata
3. **Search**: Query using natural language to find semantically similar titles
4. **Cost**: ~$0.00002 per title (extremely cheap - 100 titles ≈ $0.002)

### Example Search Results

Query: `"superhero action movie"`

Results:
- Superman (50.67% similarity)
- The Fantastic 4: First Steps (43.98% similarity)
- The Toxic Avenger Unrated (43.97% similarity)

### Learn More

See [EMBEDDINGS.md](./EMBEDDINGS.md) for detailed documentation including:
- API reference
- SQL examples for querying
- Cost analysis
- Advanced configuration
- Troubleshooting guide

## Notes

- The script uses `ON CONFLICT (id) DO UPDATE` to handle duplicates
- Existing titles will be updated with the latest data
- Failed individual items are logged but don't stop the entire process
- Embeddings are generated automatically during ingestion
- Use the backfill script for existing titles without embeddings
