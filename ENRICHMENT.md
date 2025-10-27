# Wikipedia Enrichment Pipeline

This implements **Step 1** of the enrichment plan: fetching Wikipedia text cleanly and enriching your Supabase titles with synthesized profiles, themes, vibes, and metadata.

## What It Does

1. **Fetches Wikipedia content** - Gets summary and plot sections from Wikipedia using their REST and Action APIs
2. **Extracts slots** - Uses heuristics to identify themes, vibes, tone, pacing, setting, and protagonist
3. **Synthesizes profiles** - Uses GPT-4o-mini to create spoiler-free one-sentence loglines (≤30 words)
4. **Validates output** - Checks for spoiler words and excessive new nouns
5. **Stores in Supabase** - Saves enriched data to new columns

## New Database Columns

The following columns were added to your `titles` table:

- `profile_string` (text) - Spoiler-safe one-sentence logline
- `vibes` (text[]) - Array of vibe tags (e.g., "cozy", "bleak", "whimsical")
- `themes` (text[]) - Array of theme tags (e.g., "revenge", "coming-of-age")
- `pacing` (text) - One of: "slow-burn", "mid", "kinetic"
- `tone` (text) - One of: "earnest", "melancholic", "sardonic", "romantic", "hopeful", "darkly comic"
- `wiki_source_url` (text) - Wikipedia source URL for attribution

## Files Created

```
wikipedia-fetcher.js       # Fetches Wikipedia summary and plot sections
slot-extractor.js          # Extracts themes, vibes, tone, pacing from text
profile-synthesizer.js     # Synthesizes spoiler-free profiles with GPT
enrich-titles.js          # Orchestrates the enrichment pipeline
run-enrichment.js         # CLI script to run enrichment
test-enrichment-direct.js # Test script with known movie
```

## Usage

### Test Mode (1 title)
```bash
npm run enrich:test
```

### Enrich Specific Title by ID
```bash
node run-enrichment.js --id 12345
```

### Enrich Multiple Titles (with limit)
```bash
node run-enrichment.js --limit 10
```

### Enrich All Unenriched Titles
```bash
npm run enrich
```

## How It Works

### 1. Wikipedia Fetching

Uses two Wikipedia APIs:
- **REST API** (`/api/rest_v1/page/summary/`) - Fast, cached summary text
- **Action API** (`/w/api.php?action=parse`) - Extracts specific Plot section

Includes proper User-Agent header to comply with Wikimedia's API policy.

### 2. Slot Extraction

Heuristics-based extraction using regex dictionaries:

**Themes**: revenge, coming-of-age, found family, redemption, class struggle, survival, identity, grief, corruption, ambition, betrayal, friendship, love, sacrifice, justice, family, war, freedom, good vs evil, isolation

**Vibes**: cozy, bleak, whimsical, gritty, melancholic, tense, feel-good, absurd, cerebral, atmospheric, tender, dark, suspenseful, uplifting, tragic, humorous, intense, nostalgic, epic, intimate

**Tone**: Inferred from keywords like "satire", "romance", "bittersweet", etc.

**Pacing**: Inferred from keywords like "slow-burn", "fast-paced", "nonstop", etc.

### 3. Profile Synthesis

Uses GPT-4o-mini with structured output to generate:
- One-sentence logline (18-30 words ideal, max 30)
- Spoiler-free (no third-act reveals, deaths, twists)
- Concrete nouns preferred over adjectives
- Includes setting and central conflict

**Validation checks**:
- Word count (≤30 words)
- Banned spoiler words (dies, killer, twist, secretly, etc.)
- Noun leakage (checks for excessive new nouns not in source)

If validation fails twice, falls back to simple template.

### 4. Supabase Storage

Updates the title row with:
- Enriched profile and metadata
- Original Wikipedia slots stored in `payload.wiki_slots`
- Wikipedia source URL for attribution

**Note**: Embedding generation is **commented out** as requested. To enable later, uncomment the section in `enrich-titles.js` (lines ~75-92).

## Wikipedia Title Resolution

The script attempts to find the right Wikipedia page:

- **Movies**: Tries "Title (YYYY film)" for post-2000 films
- **TV Shows**: Uses plain title (e.g., "The Simpsons")
- **Fallback**: Plain title for older/ambiguous titles

## Rate Limiting

Default: **1.5 seconds** between requests (respects Wikipedia API guidelines)
Test mode: **0.5 seconds** (faster for single-title testing)

## Legal Compliance

✅ **Wikipedia content is NOT copied verbatim** - Used only as input for synthesis  
✅ **CC-BY-SA obligations avoided** - Generated profiles are original text  
✅ **Source URLs stored** - `wiki_source_url` for attribution and QA  
✅ **Wikidata facts (if added later)** - Would be CC0, freely usable

See: https://en.wikipedia.org/wiki/Wikipedia:Reusing_Wikipedia_content

## Troubleshooting

### No Wikipedia Content Found

Many recent movies (2024-2025) don't have Wikipedia pages yet. The script will skip these gracefully.

### Profile Validation Failures

If the LLM generates spoilers or excessive new details, the validator will regenerate or use a fallback. This is expected behavior.

### Rate Limiting

If you get HTTP 429 errors, increase the `delayMs` in `enrich-titles.js`.

## Next Steps

Once you're ready to enable embeddings:

1. Uncomment the embedding section in `enrich-titles.js` (lines ~75-92)
2. The embeddings will be generated from the `profile_string` instead of just the `overview`
3. This gives you semantic search over spoiler-free, enriched descriptions

## Examples

### Successful Enrichment

```
📚 Enriching: Inception (ID: 99999)
   Wikipedia search: "Inception (2010 film)"
✅ Fetched Wikipedia content (586 chars)
✅ Extracted slots: { tone: 'earnest', pacing: 'mid', themes: 2, vibes: 1 }
🤖 Synthesizing profile with GPT...
✅ Generated profile: "A thief who infiltrates dreams is tasked with planting an idea..."
✅ Updated Supabase record
```

### No Wikipedia Page

```
📚 Enriching: War of the Worlds (ID: 755898)
   Wikipedia search: "War of the Worlds (2025 film)"
⚠️  No Wikipedia content found for "War of the Worlds (2025 film)"
```

This is expected for upcoming releases that don't have Wikipedia coverage yet.
