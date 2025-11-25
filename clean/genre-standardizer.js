
/**
 * Standardized Genre List
 * Based on canonicalization rules in scripts/canonicalize-data.ts
 */
const ALLOWED_GENRES = new Set([
  "action", "adventure", "animation", "comedy", "crime", 
  "documentary", "drama", "family", "fantasy", "history", 
  "horror", "kids", "music", "mystery", "news", 
  "politics", "reality", "romance", "science fiction", "soap", 
  "sport", "talk", "thriller", "tv movie", "war", "western"
]);

const GENRE_MAPPINGS = {
  "sci-fi": "science fiction",
  "science-fiction": "science fiction",
  "children": "kids",
  "children's": "kids",
  "musical": "music",
  "suspense": "thriller",
  "romantic": "romance",
  "biography": "history", // Often overlaps
  "biopic": "history",
  "biographical film": "history",
  "soap opera": "soap",
  "talk show": "talk",
  "reality tv": "reality",
  
  // Common Wikidata mappings to standard genres
  "action film": "action",
  "adventure film": "adventure",
  "comedy film": "comedy",
  "crime film": "crime",
  "documentary film": "documentary",
  "drama film": "drama",
  "fantasy film": "fantasy",
  "historical film": "history",
  "horror film": "horror",
  "musical film": "music",
  "mystery film": "mystery",
  "romance film": "romance",
  "science fiction film": "science fiction",
  "thriller film": "thriller",
  "war film": "war",
  "western film": "western",
  
  // Action/Adventure compounds
  "action-adventure": ["action", "adventure"],
  "action adventure": ["action", "adventure"],
  "action comedy": ["action", "comedy"],
  "action comedy film": ["action", "comedy"],
  "crime thriller film": ["crime", "thriller"],
  "action thriller film": ["action", "thriller"],
  "action thriller": ["action", "thriller"],
  
  // Romance compounds
  "romantic comedy": ["romance", "comedy"],
  "romantic comedy film": ["romance", "comedy"],
  "romantic drama": ["romance", "drama"],
  "romantic drama film": ["romance", "drama"],
  
  // Drama compounds
  "comedy drama": ["comedy", "drama"],
  "crime drama": ["crime", "drama"],
  "crime drama film": ["crime", "drama"],
  "period drama": ["drama", "history"],
  "period piece": ["drama", "history"],
  "costume drama": ["drama", "history"],
  "courtroom drama": ["crime", "drama"],
  "legal drama": ["crime", "drama"],
  "medical drama": "drama",
  "political drama": ["politics", "drama"],
  "family drama": ["family", "drama"],
  "sports drama": ["sport", "drama"],
  "teen drama": "drama",
  
  // TV series types
  "drama television series": "drama",
  "comedy television series": "comedy",
  "sitcom": "comedy",
  "television sitcom": "comedy",
  "animated series": "animation",
  "anime": "animation",
  "miniseries": "drama",
  "television miniseries": "drama",
  "anthology series": "drama",
  "limited series": "drama",
  "procedural": ["crime", "drama"],
  "workplace comedy": "comedy",
  
  // Noir and thriller subgenres
  "neo-noir": ["crime", "thriller"],
  "film noir": ["crime", "drama"],
  "psychological thriller": "thriller",
  "techno-thriller": ["thriller", "science fiction"],
  "erotic thriller": ["thriller", "romance"],
  
  // Horror subgenres
  "psychological horror": "horror",
  "supernatural horror": "horror",
  "body horror": "horror",
  "gothic horror": "horror",
  "creature feature": "horror",
  "found footage": "horror",
  "monster film": "horror",
  "monster movie": "horror",
  "slasher": "horror",
  "zombie": "horror",
  "vampire": "horror",
  "sci-fi horror": ["science fiction", "horror"],
  "comedy horror": ["comedy", "horror"],
  "horror comedy": ["comedy", "horror"],
  
  // Comedy subgenres
  "dark comedy": "comedy",
  "black comedy": "comedy",
  "satire": "comedy",
  "parody": "comedy",
  "slapstick": "comedy",
  "mockumentary": ["comedy", "documentary"],
  "tragicomedy": ["comedy", "drama"],
  
  // Heist/Crime subgenres
  "heist film": ["crime", "thriller"],
  "heist": ["crime", "thriller"],
  "true crime": ["crime", "documentary"],
  "police procedural": ["crime", "drama"],
  
  // Disaster/Survival
  "disaster film": ["action", "thriller"],
  "disaster": ["action", "thriller"],
  "survival": ["action", "thriller"],
  
  // Sci-Fi subgenres
  "dystopian film": "science fiction",
  "dystopian": "science fiction",
  "post-apocalyptic": "science fiction",
  "cyberpunk": "science fiction",
  "space opera": "science fiction",
  
  // Fantasy/Supernatural
  "supernatural": ["fantasy", "horror"],
  "dark fantasy": ["fantasy", "horror"],
  "urban fantasy": "fantasy",
  "high fantasy": "fantasy",
  
  // Epic/Historical
  "epic": ["drama", "history"],
  "epic film": ["drama", "history"],
  "historical drama": ["drama", "history"],
  
  // Coming-of-age
  "coming-of-age film": ["drama", "family"],
  "coming-of-age": ["drama", "family"],
  
  // Superhero
  "superhero film": ["action", "fantasy", "science fiction"],
  "superhero television program": ["action", "fantasy", "science fiction"],
  "superhero": ["action", "fantasy", "science fiction"],
  
  // Action subgenres
  "martial arts film": "action",
  "martial arts": "action",
  "spy film": ["action", "thriller"],
  "espionage": ["action", "thriller"],
  
  // Sports
  "sports film": "sport",
  "sports": "sport",
  "sports documentary": ["sport", "documentary"]
};

/**
 * Normalize a single genre string to our standardized set
 * @param {string} genre - Raw genre string (e.g., "Science Fiction", "Sci-Fi & Fantasy")
 * @returns {string[]} - Array of standardized genres
 */
export function normalizeGenre(genre) {
  if (!genre) return [];
  
  const lower = genre.toLowerCase().trim();
  
  // 1. Check explicit mapping first (handles "crime thriller" -> ["crime", "thriller"])
  if (GENRE_MAPPINGS[lower]) {
      const mapped = GENRE_MAPPINGS[lower];
      if (Array.isArray(mapped)) {
          return mapped.filter(g => ALLOWED_GENRES.has(g));
      }
      return ALLOWED_GENRES.has(mapped) ? [mapped] : [];
  }

  const results = [];

  // 2. Handle compound genres with "&"
  if (lower.includes("&")) {
    const parts = lower.split("&").map(p => p.trim());
    parts.forEach(p => {
        const mapped = GENRE_MAPPINGS[p] || p;
        if (Array.isArray(mapped)) {
             mapped.forEach(m => { if (ALLOWED_GENRES.has(m)) results.push(m); });
        } else if (ALLOWED_GENRES.has(mapped)) {
            results.push(mapped);
        }
    });
    return results;
  }

  // 3. Fuzzy match suffixes (e.g., "xxx film", "xxx series")
  // If "action film" isn't in mappings, try removing "film"
  const clean = lower
    .replace(/ film$/, "")
    .replace(/ movie$/, "")
    .replace(/ television series$/, "")
    .replace(/ tv series$/, "")
    .replace(/ series$/, "")
    .replace(/ program$/, "")
    .trim();
  
  if (ALLOWED_GENRES.has(clean)) {
      return [clean];
  }

  // 4. Check if valid as-is
  if (ALLOWED_GENRES.has(lower)) {
    return [lower];
  }

  return results;
}

export { ALLOWED_GENRES };
