# Quick Start Guide - Vector Embeddings

## 🎉 Congratulations!

Your TMDB ingestion pipeline now has **automatic vector embeddings** for semantic search! All 40 of your existing titles have embeddings generated and stored.

## ✅ What's Complete

- [x] OpenAI SDK installed
- [x] API key configured in `.env`
- [x] Embedding generation integrated into ingestion workflow
- [x] All 40 existing titles have embeddings (100% complete)
- [x] Semantic search function created in database
- [x] HNSW index created for fast similarity searches
- [x] Demo search script ready to use

## 🚀 Quick Commands

### Search for Similar Titles
```bash
npm run search "romantic comedy"
npm run search "space adventure sci-fi"
npm run search "horror with demons"
```

### Ingest New Titles (with automatic embeddings)
```bash
npm run ingest
```

### Backfill Embeddings (if needed)
```bash
npm run backfill
```

## 📊 Database Status

- **Total Titles**: 40
- **With Embeddings**: 40 (100%)
- **Embedding Dimensions**: 1536
- **Search Function**: `match_titles()` ✅ Created
- **Vector Index**: HNSW ✅ Created

## 💡 Example Usage

### From Command Line

```bash
# Search with custom query
npm run search "superhero action movie"

# Run demo examples
npm run search
```

### From Your Application

```javascript
import { supabase } from './supabase-upsert.js'
import { generateEmbeddings } from './embeddings.js'

async function search(query) {
  // Generate embedding for query
  const [queryEmbedding] = await generateEmbeddings([{
    title: query,
    overview: query,
    kind: 'search_query'
  }])
  
  // Search database
  const { data } = await supabase.rpc('match_titles', {
    query_embedding: queryEmbedding,
    match_threshold: 0.5,
    match_count: 10
  })
  
  return data
}
```

### Direct SQL Query

```sql
-- You need to generate the query_embedding first using OpenAI API
SELECT * FROM match_titles(
  '[0.1, 0.2, ...]'::vector(1536),  -- Your query embedding
  0.5,  -- Minimum similarity (0-1)
  10    -- Number of results
);
```

## 💰 Cost Estimate

Based on OpenAI's `text-embedding-3-small` pricing:

- **40 existing titles**: < $0.001 (already done!)
- **Next 100 titles**: ~$0.002 (1/5th of a penny)
- **1,000 titles**: ~$0.02 (2 cents)

Your current usage: **Less than 1/10th of a penny** ✅

## 🎯 Test It Out

Try this search to see semantic matching in action:

```bash
npm run search "superhero saving the world"
```

You'll see results ranked by semantic similarity, not just keyword matching!

Expected results:
- Superman (high similarity)
- The Fantastic 4 (high similarity)
- Other action/adventure titles

## 📚 Next Steps

1. **Test Searches**: Try various queries to see how semantic search works
2. **Integrate into App**: Use the `match_titles()` function in your frontend
3. **Ingest More Data**: Run `npm run ingest` to add more titles with embeddings
4. **Read Full Docs**: Check out `EMBEDDINGS.md` for advanced features

## 🔍 Verify Everything Works

Quick verification checklist:

```bash
# 1. Check embeddings exist
npm run search "action movie"

# 2. Verify database (should show 40/40)
# Run in Supabase SQL Editor:
# SELECT COUNT(*) as total, COUNT(embedding) as with_embeddings FROM titles;

# 3. Test new ingestion (will auto-generate embeddings)
npm run ingest
```

## 🛠️ Troubleshooting

### Search returns no results
- Make sure embeddings exist: `SELECT COUNT(embedding) FROM titles;`
- Check if `match_titles()` function exists
- Verify OpenAI API key is valid

### "Rate limit exceeded" error
- You've hit OpenAI's rate limit (normal for free tier)
- Wait a minute and try again
- Consider upgrading OpenAI tier for higher limits

### Embeddings are NULL after ingestion
- Check console logs for errors
- Verify `OPENAI_API_KEY` in `.env`
- Run `npm run backfill` to retry

## 📖 Documentation

- **README.md**: Main project documentation
- **EMBEDDINGS.md**: Complete embeddings guide (API, SQL, advanced config)
- **create-search-function.sql**: SQL function for semantic search

## 🎊 You're All Set!

Your vector embeddings are working perfectly. Start searching and enjoy the power of semantic similarity! 🚀
