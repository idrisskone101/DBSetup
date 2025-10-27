# Movie Search Frontend - Project Prompt

## Project Overview

Build a simple, elegant React frontend with an Express.js backend for a semantic movie/TV search application. The app uses a multi-embedding vector database in Supabase with LLM-powered dynamic weight adjustment for optimal search results.

## Architecture Summary

### Database (Already Set Up)
- **Platform**: Supabase (PostgreSQL with pgvector extension)
- **Table**: `titles` (990 movies/TV shows)
- **Vector Embeddings**: Each title has 3 separate 1536-dimensional embeddings:
  1. **Content Embedding** - Story/narrative elements (plot, themes, overview, story structure)
  2. **Vibe Embedding** - Emotional/atmospheric profile (vibes, tone, pacing, tagline)
  3. **Metadata Embedding** - Factual/categorical data (genres, director, cast, certification)

### Key Innovation: LLM-Based Weight Adjustment

The system uses GPT-4o-mini to analyze user queries and dynamically calculate optimal weights for each embedding type:

- **"funny superhero movies"** → Metadata-heavy (genre focus): `metadata: 55%, vibe: 25%, content: 20%`
- **"cozy romantic comedies"** → Vibe-heavy (mood focus): `vibe: 60%, metadata: 25%, content: 15%`
- **"Christopher Nolan films"** → Metadata-heavy (director focus): `metadata: 70%, content: 20%, vibe: 10%`
- **"time travel paradox story"** → Content-heavy (plot focus): `content: 60%, metadata: 25%, vibe: 15%`
- **"dark revenge thriller"** → Balanced: `vibe: 45%, content: 35%, metadata: 20%`

**Default weights if LLM fails**: `content: 40%, vibe: 35%, metadata: 25%`

## Database Schema

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

  -- Rich metadata
  genres TEXT[],
  languages TEXT[],
  cast JSONB,  -- [{name, character, order, profile_path}]
  director TEXT,
  writers TEXT[],
  creators TEXT[],  -- TV shows only
  certification TEXT,  -- e.g., "PG-13", "R", "TV-MA"
  production_countries TEXT[],
  keywords TEXT[],

  -- Enriched content
  profile_string TEXT,  -- One-sentence spoiler-safe logline
  vibes TEXT[],  -- e.g., ["cozy", "whimsical", "dark"]
  themes TEXT[],  -- e.g., ["revenge", "coming-of-age"]
  tone TEXT,  -- e.g., "earnest", "melancholic", "noir"
  pacing TEXT,  -- e.g., "slow-burn", "kinetic", "contemplative"
  slots JSONB,  -- Story structure: {protagonist, setting_place, setting_time, goal, obstacle, stakes}
  tagline TEXT,

  -- Collections
  collection_id BIGINT,
  collection_name TEXT,

  -- Vector embeddings (1536-dimensional each)
  content_embedding VECTOR(1536),
  vibe_embedding VECTOR(1536),
  metadata_embedding VECTOR(1536),

  -- Metadata
  providers JSONB,
  payload JSONB,
  wiki_source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Search Function (Already Deployed)

The database has a PostgreSQL function `match_titles_multi()` that performs weighted multi-embedding search:

```sql
SELECT * FROM match_titles_multi(
  query_content_embedding,    -- vector(1536)
  query_vibe_embedding,        -- vector(1536)
  query_metadata_embedding,    -- vector(1536)
  weight_content,              -- float (default: 0.40)
  weight_vibe,                 -- float (default: 0.35)
  weight_metadata,             -- float (default: 0.25)
  match_threshold,             -- float (default: 0.3)
  match_count                  -- int (default: 10)
);
```

**Returns**:
```javascript
{
  id: bigint,
  title: string,
  kind: 'movie' | 'tv',
  release_date: date,
  overview: string,
  genres: string[],
  director: string,
  vibes: string[],
  themes: string[],
  runtime_minutes: int,
  vote_average: number,
  certification: string,
  content_score: float,      // Individual similarity (0-1)
  vibe_score: float,         // Individual similarity (0-1)
  metadata_score: float,     // Individual similarity (0-1)
  combined_score: float,     // Weighted combined score (0-1)
  strongest_signal: 'content' | 'vibe' | 'metadata'  // Which embedding matched best
}
```

## Frontend Requirements

### Tech Stack
- **Framework**: React (with Vite)
- **Styling**: Tailwind CSS, make sure to use shadcn ui where possible.
- **Design Philosophy**: Apple-inspired - clean, minimal, elegant, tasteful
- **Port**: 3001 (frontend dev server)
- ** MCPs to use**: Supabase, Chrome Dev Tools, Playwright

### UI Design

#### Search Input
- **Large, centered search box** with placeholder: "Search for movies and TV shows..."
- **Search icon** inside the input (left side)
- **Subtle gradient background** (similar to Apple's design language)
- **Responsive design**: Mobile-first approach
- **Auto-focus** on page load
- **Submit on Enter** or button click

#### Loading State
- **Elegant loading spinner** or skeleton cards while searching
- **Show query analysis**: "Analyzing query..." → "Searching with vibe-focused weights (60% vibe, 25% metadata, 15% content)..."

#### Results Display
- **Card-based layout** with poster images
- **Grid**: 3 columns on desktop, 2 on tablet, 1 on mobile
- **Each card shows**:
  - Poster image (or placeholder if missing)
  - Title
  - Year and kind (movie/TV)
  - Combined similarity score (with visual progress bar)
  - Top 3 genres
  - Top 3 vibes (if available)
  - Rating (vote_average)
  - Short overview (truncated to ~150 characters)
- **Hover effect**: Subtle scale and shadow
- **Click to expand**: Show full details in modal
  - Full overview
  - Director/creators
  - Cast (top 5)
  - Themes
  - All vibes
  - Score breakdown (content/vibe/metadata individual scores)
  - Strongest signal indicator

#### Empty State
- **No results**: "No matches found. Try a different search!"
- **Initial state**: Show example searches or trending titles

### Components Structure

```
src/
├── components/
│   ├── SearchBar.jsx          // Main search input
│   ├── ResultsGrid.jsx         // Grid container for cards
│   ├── MovieCard.jsx           // Individual movie/TV card
│   ├── MovieModal.jsx          // Expanded details modal
│   ├── LoadingSpinner.jsx      // Loading state
│   └── ScoreBreakdown.jsx      // Visual score breakdown (progress bars)
├── hooks/
│   └── useSearch.js            // Search API hook
├── lib/
│   └── api.js                  // API client
├── App.jsx                     // Main app component
└── main.jsx                    // Entry point
```

## Backend Requirements

### Tech Stack
- **Framework**: Express.js
- **Port**: 5001
- **Database Client**: @supabase/supabase-js
- **OpenAI Client**: openai (for embeddings and query analysis)

### API Endpoints

#### POST /api/search
**Request Body**:
```json
{
  "query": "cozy romantic comedies",
  "matchCount": 10,         // optional, default: 10
  "matchThreshold": 0.3     // optional, default: 0.3
}
```

**Response**:
```json
{
  "query": "cozy romantic comedies",
  "weights": {
    "content": 0.15,
    "vibe": 0.60,
    "metadata": 0.25
  },
  "weightReasoning": "Query emphasizes mood/atmosphere (cozy) suggesting vibe-heavy weighting",
  "results": [
    {
      "id": 123,
      "title": "When Harry Met Sally",
      "kind": "movie",
      "release_date": "1989-07-21",
      "overview": "...",
      "genres": ["Comedy", "Romance"],
      "vibes": ["cozy", "heartwarming", "witty"],
      "themes": ["friendship", "love", "timing"],
      "director": "Rob Reiner",
      "vote_average": 7.4,
      "certification": "R",
      "runtime_minutes": 96,
      "poster_path": "/path/to/poster.jpg",
      "content_score": 0.72,
      "vibe_score": 0.89,
      "metadata_score": 0.81,
      "combined_score": 0.847,
      "strongest_signal": "vibe"
    }
  ],
  "count": 10
}
```

**Error Response**:
```json
{
  "error": "Query analysis failed",
  "message": "OpenAI API error: ...",
  "fallbackUsed": true,
  "weights": { "content": 0.4, "vibe": 0.35, "metadata": 0.25 }
}
```

### Backend Flow

```javascript
// 1. Receive search query
const { query, matchCount = 10, matchThreshold = 0.3 } = req.body;

// 2. Analyze query with LLM to get weights
const { content, vibe, metadata, reasoning } = await analyzeQueryIntent(query);

// 3. Generate 3 embeddings for the query
const embeddings = await generateQueryEmbeddings(query);
// Returns: { content: vector[], vibe: vector[], metadata: vector[] }

// 4. Call Supabase function
const { data, error } = await supabase.rpc('match_titles_multi', {
  query_content_embedding: embeddings.content,
  query_vibe_embedding: embeddings.vibe,
  query_metadata_embedding: embeddings.metadata,
  weight_content: content,
  weight_vibe: vibe,
  weight_metadata: metadata,
  match_threshold: matchThreshold,
  match_count: matchCount
});

// 5. Return results with metadata
return {
  query,
  weights: { content, vibe, metadata },
  weightReasoning: reasoning,
  results: data,
  count: data.length
};
```

### Key Backend Functions

#### analyzeQueryIntent(query)
```javascript
async function analyzeQueryIntent(query) {
  const systemPrompt = `You are a query analyzer for a movie/TV semantic search system with three embedding types:

1. CONTENT embedding: Captures story/plot elements
   - Narrative themes (revenge, redemption, coming-of-age)
   - Story structure (time travel, heist, mystery)
   - Character arcs and relationships

2. VIBE embedding: Captures emotional/atmospheric qualities
   - Mood and feeling (cozy, dark, whimsical, gritty)
   - Tone (earnest, melancholic, campy, noir)
   - Pacing (slow-burn, kinetic, contemplative)

3. METADATA embedding: Captures factual/categorical information
   - Genres (superhero, comedy, thriller)
   - Directors and creators
   - Actors, years, ratings

WEIGHTING RULES:
- Genre/franchise/director/actor mentions → prioritize METADATA (0.5-0.7)
- Plot/story/theme descriptions → prioritize CONTENT (0.5-0.7)
- Mood/feeling/atmosphere adjectives → prioritize VIBE (0.5-0.7)
- Hybrid queries → distribute proportionally
- Ambiguous → default balanced (0.4, 0.35, 0.25)

Return ONLY valid JSON:
{
  "content": 0.XX,
  "vibe": 0.XX,
  "metadata": 0.XX,
  "reasoning": "Brief explanation"
}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Analyze this query: "${query}"` }
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
    max_tokens: 150
  });

  const result = JSON.parse(response.choices[0].message.content);

  // Validate and normalize weights
  const sum = result.content + result.vibe + result.metadata;
  if (Math.abs(sum - 1.0) > 0.01) {
    result.content /= sum;
    result.vibe /= sum;
    result.metadata /= sum;
  }

  return result;
}
```

#### generateQueryEmbeddings(query)
```javascript
async function generateQueryEmbeddings(query) {
  // Format query for each embedding type
  const texts = {
    vibe: `Vibes: ${query}. Tone: ${query}. Tagline: ${query}`,
    content: `Story: ${query}. Overview: ${query}. Themes: ${query}`,
    metadata: `Genres: ${query}. Type: ${query}. Keywords: ${query}`
  };

  // Generate all 3 embeddings in single API call
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: [texts.content, texts.vibe, texts.metadata],
    encoding_format: "float"
  });

  return {
    content: response.data[0].embedding,
    vibe: response.data[1].embedding,
    metadata: response.data[2].embedding
  };
}
```

## Environment Variables

```bash
# .env file

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# OpenAI
OPENAI_API_KEY=your-openai-api-key-here

# Server
PORT=5001
```

## Installation & Setup

```bash
# Install dependencies
npm install

# Required packages
npm install express cors dotenv @supabase/supabase-js openai

# Frontend dependencies
npm install react react-dom react-router-dom

# Dev dependencies
npm install -D vite @vitejs/plugin-react tailwindcss postcss autoprefixer concurrently
```

## Development Commands

```bash
# Start both client and server concurrently
npm run dev

# Start only frontend (port 3001)
npm run dev:client

# Start only backend (port 5001)
npm run dev:server
```

## Vite Proxy Configuration

Configure Vite to proxy API requests to the Express backend:

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true
      }
    }
  }
})
```

## Package.json Scripts

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:client\" \"npm run dev:server\"",
    "dev:client": "vite",
    "dev:server": "node server/index.js",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

## Project Structure

```
karma-frontend/
├── src/
│   ├── components/
│   │   ├── SearchBar.jsx
│   │   ├── ResultsGrid.jsx
│   │   ├── MovieCard.jsx
│   │   ├── MovieModal.jsx
│   │   ├── LoadingSpinner.jsx
│   │   └── ScoreBreakdown.jsx
│   ├── hooks/
│   │   └── useSearch.js
│   ├── lib/
│   │   └── api.js
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── server/
│   ├── index.js          // Express server
│   ├── search.js         // Search endpoint logic
│   └── embeddings.js     // Embedding generation utilities
├── public/
├── .env
├── .env.example
├── package.json
├── vite.config.js
├── tailwind.config.js
└── README.md
```

## Design Guidelines

### Colors (Tailwind)
- **Background**: `bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900`
- **Cards**: `bg-white/10 backdrop-blur-lg border border-white/20`
- **Text**: `text-white` primary, `text-gray-300` secondary
- **Accents**: `text-purple-400`, `text-pink-400` for scores/highlights
- **Hover**: `hover:scale-105 transition-transform duration-200`

### Typography
- **Headings**: `font-bold tracking-tight`
- **Body**: `font-normal leading-relaxed`
- **Scores**: `font-mono` for numerical values

### Spacing
- **Consistent padding**: `p-4`, `p-6`, `p-8`
- **Grid gaps**: `gap-4`, `gap-6`
- **Generous whitespace**: Don't crowd the UI

### Animations
- **Subtle entrance**: Fade in results with stagger effect
- **Smooth transitions**: Use `transition-all duration-200`
- **Loading**: Pulse or spinner with `animate-spin` or `animate-pulse`

## Testing the API (Manual)

Once the backend is running, test with:

```bash
curl -X POST http://localhost:5001/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "cozy romantic comedies", "matchCount": 5}'
```

## Important Notes

1. **No Re-ranking**: Skip any re-ranking logic for now. The weighted search is the final ranking.

2. **Poster Images**: Use TMDB image URLs: `https://image.tmdb.org/t/p/w500${poster_path}`

3. **Error Handling**: Always have fallback weights if LLM fails. Show user-friendly errors.

4. **Performance**: The search should feel instant (<2 seconds total including LLM analysis)

5. **Mobile First**: Design for mobile, enhance for desktop

6. **Accessibility**: Use semantic HTML, proper ARIA labels, keyboard navigation

## Success Criteria

- Clean, minimal search interface that auto-focuses on load
- Search results display within 2 seconds
- Weight reasoning is visible (optional: show to user or just in console)
- Results show poster, title, year, genres, score with visual progress bar
- Click to expand shows full details including score breakdown
- Responsive design works on mobile, tablet, desktop
- Error states are graceful with helpful messages
- Code is clean, well-commented, and follows React best practices

## Optional Enhancements (Future)

- Search history (localStorage)
- Bookmarking/favorites
- Filter by kind (movie/TV), year, rating
- Sort by different criteria (score, year, rating)
- Share search results (URL params)
- Dark/light mode toggle
- Infinite scroll or pagination
- Show "similar titles" for each result

## Reference: Existing Test Implementation

The DBSetup folder has a working CLI implementation in `test-multi-embedding-search.js` that you can reference for:
- Query analysis logic
- Embedding generation
- Search function calls
- Result formatting

The key difference: Your frontend will wrap this in a beautiful UI instead of CLI output.

---

## Questions to Consider

Before starting, clarify:
1. Should we show the weight reasoning to users, or keep it internal?
2. Do you want any filtering options (year, rating, genre) in the initial version?
3. Should the modal show streaming service availability (`providers` field)?
4. Do you want to display the "strongest signal" indicator on cards?
5. Any specific example searches you want to highlight on the empty state?

---

## Let's Build It!

This prompt contains everything you need. Focus on:
1. Setting up the Express backend with the search endpoint
2. Creating the React frontend with search input and results grid
3. Connecting them via the API
4. Making it beautiful with Tailwind and Apple-inspired design

Keep it simple, elegant, and functional. You can always add features later!
