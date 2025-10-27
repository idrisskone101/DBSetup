import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface Title {
  id: number;
  title: string;
  original_title: string | null;
  overview: string | null;
  kind: "movie" | "tv";
  release_date: string | null;
  genres: string[] | null;
  wiki_source_url: string | null;
  imdb_id: string | null;
}

interface EnrichedMetadata {
  profile_string: string;
  themes: string[];
  pacing: string;
  slots: {
    protagonist: string;
    setting_place: string;
    setting_time: string;
    goal: string;
    obstacle: string;
    stakes: string;
  };
}

async function fetchWikipediaContent(
  title: string,
  kind: "movie" | "tv",
): Promise<string | null> {
  try {
    const searchTitle =
      kind === "movie" ? `${title} (film)` : `${title} (TV series)`;
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(searchTitle)}&prop=extracts&explaintext=1&exintro=1`;

    const response = await fetch(searchUrl);
    const data = await response.json();

    const pages = data.query?.pages;
    if (!pages) return null;

    const pageId = Object.keys(pages)[0];
    if (pageId === "-1") {
      // Try without the suffix
      const fallbackUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(title)}&prop=extracts&explaintext=1&exintro=1`;
      const fallbackResponse = await fetch(fallbackUrl);
      const fallbackData = await fallbackResponse.json();
      const fallbackPages = fallbackData.query?.pages;
      if (!fallbackPages) return null;
      const fallbackPageId = Object.keys(fallbackPages)[0];
      if (fallbackPageId === "-1") return null;
      return fallbackPages[fallbackPageId].extract;
    }

    return pages[pageId].extract;
  } catch (error) {
    console.error(`Error fetching Wikipedia content for ${title}:`, error);
    return null;
  }
}

async function enrichWithAI(
  title: Title,
  wikiContent: string,
): Promise<EnrichedMetadata | null> {
  try {
    const prompt = `You are a film and TV metadata expert. Analyze the following ${title.kind} and generate structured metadata.

Title: ${title.title}
${title.overview ? `Overview: ${title.overview}` : ""}
${title.genres ? `Genres: ${title.genres.join(", ")}` : ""}
${title.release_date ? `Release Date: ${title.release_date}` : ""}

Wikipedia Summary:
${wikiContent}

Generate the following metadata:

1. **profile_string**: A spoiler-free one-sentence logline following this format: "[Title] is a [genre] set in [year/time period] exploring themes of [main theme]."
   - Keep it concise and informative
   - Use the release year from the metadata
   - Pick the most central theme

2. **themes**: An array of 3-6 thematic tags (e.g., survival, family, revenge, coming-of-age, identity, power, redemption, loss, hope, freedom)
   - Focus on universal themes, not plot details
   - Use lowercase single words or short phrases

3. **pacing**: A single descriptor for the pacing (e.g., slow-burn, mid, kinetic, frenetic, contemplative, methodical, brisk)
   - Be specific and accurate to the actual viewing experience
   - Use lowercase

4. **slots**: Story structure elements with these exact keys:
   - protagonist: Who is the main character/group? (e.g., "a young wizard", "the Stark family")
   - setting_place: Where does it take place? (e.g., "New York City", "a dystopian future Earth")
   - setting_time: When does it take place? (e.g., "1990s", "present day", "medieval times")
   - goal: What does the protagonist want? Start with "to" (e.g., "to save the world")
   - obstacle: What stands in their way? (e.g., "a corrupt government", "personal trauma")
   - stakes: What's at risk? (e.g., "the fate of humanity", "their family's legacy")

Return ONLY valid JSON with this exact structure:
{
  "profile_string": "string",
  "themes": ["string"],
  "pacing": "string",
  "slots": {
    "protagonist": "string",
    "setting_place": "string",
    "setting_time": "string",
    "goal": "string",
    "obstacle": "string",
    "stakes": "string"
  }
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a film and TV metadata expert. Return only valid JSON, no markdown or extra text.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content;
    if (!content) return null;

    const metadata = JSON.parse(content);
    return metadata;
  } catch (error) {
    console.error(`Error enriching title ${title.title}:`, error);
    return null;
  }
}

async function updateTitleMetadata(
  titleId: number,
  metadata: EnrichedMetadata,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("titles")
      .update({
        profile_string: metadata.profile_string,
        themes: metadata.themes,
        pacing: metadata.pacing,
        slots: metadata.slots,
      })
      .eq("id", titleId);

    if (error) {
      console.error(`Error updating title ${titleId}:`, error);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error updating title ${titleId}:`, error);
    return false;
  }
}

async function enrichTitle(title: Title): Promise<boolean> {
  console.log(`\nProcessing: ${title.title} (${title.kind})...`);

  // Fetch Wikipedia content
  const wikiContent = await fetchWikipediaContent(title.title, title.kind);
  if (!wikiContent) {
    console.log(`  ❌ Could not fetch Wikipedia content`);
    return false;
  }

  console.log(`  ✓ Fetched Wikipedia content (${wikiContent.length} chars)`);

  // Enrich with AI
  const metadata = await enrichWithAI(title, wikiContent);
  if (!metadata) {
    console.log(`  ❌ Could not generate metadata`);
    return false;
  }

  console.log(`  ✓ Generated metadata`);
  console.log(`    Profile: ${metadata.profile_string}`);
  console.log(`    Themes: ${metadata.themes.join(", ")}`);
  console.log(`    Pacing: ${metadata.pacing}`);

  // Update in Supabase
  const success = await updateTitleMetadata(title.id, metadata);
  if (!success) {
    console.log(`  ❌ Could not update database`);
    return false;
  }

  console.log(`  ✓ Updated in database`);
  return true;
}

async function main() {
  console.log("🎬 Title Enrichment Script Starting...\n");

  // Get all titles missing metadata
  const { data: titles, error } = await supabase
    .from("titles")
    .select(
      "id, title, original_title, overview, kind, release_date, genres, wiki_source_url, imdb_id",
    )
    .or("profile_string.is.null,themes.is.null,pacing.is.null,slots.is.null")
    .order("id");

  if (error) {
    console.error("Error fetching titles:", error);
    return;
  }

  if (!titles || titles.length === 0) {
    console.log("No titles to enrich!");
    return;
  }

  console.log(`Found ${titles.length} titles to enrich\n`);
  console.log("─".repeat(60));

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    console.log(`\n[${i + 1}/${titles.length}]`);

    const success = await enrichTitle(title);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // Rate limiting: wait 1 second between requests
    if (i < titles.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log("\n✨ Enrichment Complete!");
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Total: ${titles.length}`);
}

main().catch(console.error);
