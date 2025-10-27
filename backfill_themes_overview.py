#!/usr/bin/env python3
"""
TMDB Themes & Overview Backfill Script
Fetches missing overviews from TMDB and generates themes using Claude AI
"""

import os
import time
import requests
from supabase import create_client, Client
from typing import List, Dict, Optional
from dotenv import load_dotenv
import anthropic

# Load environment variables
load_dotenv()

# Configuration
TMDB_API_KEY = os.getenv("TMDB_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Rate limiting
TMDB_RATE_LIMIT_DELAY = 0.25
CLAUDE_RATE_LIMIT_DELAY = 1.0  # More conservative for Claude

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None


def fetch_tmdb_overview(tmdb_id: int, kind: str) -> Optional[str]:
    """
    Fetch overview from TMDB API

    Args:
        tmdb_id: TMDB ID (stored in your 'id' field)
        kind: 'movie' or 'tv'

    Returns:
        Overview string or None if error
    """
    try:
        if kind == "movie":
            url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
        else:
            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}"

        headers = {
            "Authorization": f"Bearer {TMDB_API_KEY}",
            "accept": "application/json",
        }

        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()

        data = response.json()
        overview = data.get("overview", "").strip()

        return overview if overview else None

    except requests.exceptions.RequestException as e:
        print(f"  ❌ Error fetching TMDB overview: {e}")
        return None
    except Exception as e:
        print(f"  ❌ Unexpected error: {e}")
        return None


def generate_themes_with_claude(
    title: str, overview: str, genres: List[str]
) -> Optional[List[str]]:
    """
    Use Claude AI to extract themes from overview

    Args:
        title: Movie/TV show title
        overview: Plot overview
        genres: List of genre strings

    Returns:
        List of theme strings (3-5 themes)
    """
    if not claude:
        print("  ⚠️  Claude API key not configured - skipping theme generation")
        return None

    try:
        prompt = f"""Analyze this {"/".join(genres)} title and extract 3-5 core thematic tags.

Title: {title}
Overview: {overview}

Return ONLY a comma-separated list of thematic tags (e.g., "revenge, redemption, family, identity, power").

Focus on universal human themes like:
- Emotions: love, fear, hope, despair, grief
- Relationships: family, friendship, betrayal, loyalty
- Concepts: identity, justice, freedom, sacrifice, survival
- Social: inequality, corruption, prejudice, tradition
- Existential: mortality, purpose, memory, truth

Themes (comma-separated):"""

        message = claude.messages.create(
            model="claude-3-5-haiku-20241022",  # Fast and cheap for this task
            max_tokens=100,
            messages=[{"role": "user", "content": prompt}],
        )

        themes_text = message.content[0].text.strip()
        themes = [theme.strip() for theme in themes_text.split(",")]

        # Clean up and validate
        themes = [t for t in themes if t and len(t) > 2 and len(t) < 50]

        return themes[:5] if themes else None

    except Exception as e:
        print(f"  ❌ Error generating themes with Claude: {e}")
        return None


def get_titles_missing_overview(limit: Optional[int] = None) -> List[Dict]:
    """Fetch titles missing overview"""
    try:
        query = (
            supabase.table("titles")
            .select("id, title, kind, overview, popularity")
            .is_("overview", None)
        )

        if limit:
            query = query.limit(limit)

        query = query.order("popularity", desc=True)
        response = query.execute()
        return response.data
    except Exception as e:
        print(f"❌ Error fetching titles: {e}")
        return []


def get_titles_missing_themes(limit: Optional[int] = None) -> List[Dict]:
    """Fetch titles missing themes"""
    try:
        query = (
            supabase.table("titles")
            .select("id, title, kind, overview, genres, themes, vibes, popularity")
            .is_("themes", None)
        )

        if limit:
            query = query.limit(limit)

        query = query.order("popularity", desc=True)
        response = query.execute()
        return response.data
    except Exception as e:
        print(f"❌ Error fetching titles: {e}")
        return []


def update_overview_in_db(title_id: int, overview: str) -> bool:
    """Update overview in database"""
    try:
        supabase.table("titles").update({"overview": overview}).eq(
            "id", title_id
        ).execute()
        return True
    except Exception as e:
        print(f"  ❌ Error updating database: {e}")
        return False


def update_themes_in_db(title_id: int, themes: List[str]) -> bool:
    """Update themes in database"""
    try:
        supabase.table("titles").update({"themes": themes}).eq("id", title_id).execute()
        return True
    except Exception as e:
        print(f"  ❌ Error updating database: {e}")
        return False


def backfill_overviews(titles: List[Dict], dry_run: bool = False) -> Dict[str, int]:
    """Backfill overviews from TMDB"""
    stats = {"total": len(titles), "success": 0, "not_found": 0, "error": 0}

    print(f"\n🚀 Starting overview backfill for {len(titles)} titles...")
    if dry_run:
        print("🔍 DRY RUN MODE\n")

    for i, title in enumerate(titles, 1):
        title_id = title["id"]
        title_name = title["title"]
        kind = title["kind"]

        print(f"\n[{i}/{len(titles)}] {title_name} ({kind})")

        overview = fetch_tmdb_overview(title_id, kind)

        if overview is None:
            stats["error"] += 1
            continue

        if not overview:
            print(f"  ⚠️  No overview found on TMDB")
            stats["not_found"] += 1
            continue

        print(f"  ✅ Found overview ({len(overview)} chars)")

        if not dry_run:
            if update_overview_in_db(title_id, overview):
                stats["success"] += 1
                print(f"  💾 Database updated")
            else:
                stats["error"] += 1
        else:
            stats["success"] += 1

        time.sleep(TMDB_RATE_LIMIT_DELAY)

    return stats


def backfill_themes(
    titles: List[Dict], dry_run: bool = False, use_claude: bool = True
) -> Dict[str, int]:
    """Backfill themes using Claude AI"""
    stats = {"total": len(titles), "success": 0, "no_overview": 0, "error": 0}

    if not use_claude or not claude:
        print("⚠️  Claude AI not available - cannot generate themes")
        return stats

    print(f"\n🚀 Starting theme generation for {len(titles)} titles...")
    if dry_run:
        print("🔍 DRY RUN MODE\n")

    for i, title in enumerate(titles, 1):
        title_id = title["id"]
        title_name = title["title"]
        overview = title.get("overview")
        genres = title.get("genres", [])

        print(f"\n[{i}/{len(titles)}] {title_name}")

        if not overview:
            print(f"  ⚠️  No overview available - cannot generate themes")
            stats["no_overview"] += 1
            continue

        themes = generate_themes_with_claude(title_name, overview, genres)

        if not themes:
            stats["error"] += 1
            continue

        print(f"  ✅ Generated {len(themes)} themes: {', '.join(themes)}")

        if not dry_run:
            if update_themes_in_db(title_id, themes):
                stats["success"] += 1
                print(f"  💾 Database updated")
            else:
                stats["error"] += 1
        else:
            stats["success"] += 1

        time.sleep(CLAUDE_RATE_LIMIT_DELAY)

    return stats


def print_stats(stats: Dict[str, int], operation: str):
    """Print statistics"""
    print("\n" + "=" * 60)
    print(f"📊 {operation.upper()} STATISTICS")
    print("=" * 60)
    print(f"Total processed:     {stats['total']}")
    print(f"✅ Success:          {stats['success']}")

    if "not_found" in stats:
        print(f"⚠️  Not found:        {stats['not_found']}")
    if "no_overview" in stats:
        print(f"⚠️  No overview:      {stats['no_overview']}")

    print(f"❌ Errors:           {stats['error']}")

    if stats["total"] > 0:
        print(f"\nSuccess rate: {stats['success'] / stats['total'] * 100:.1f}%")
    print("=" * 60 + "\n")


def main():
    """Main execution"""
    print("=" * 60)
    print("🎬 TMDB OVERVIEW & THEME BACKFILL TOOL")
    print("=" * 60)

    # Validate configuration
    if not TMDB_API_KEY:
        print("❌ Error: TMDB_API_KEY not found")
        return

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Error: Supabase credentials not found")
        return

    print("✅ Configuration validated\n")

    # Get user choice
    print("What would you like to backfill?")
    print("1. Overviews (26 titles)")
    print("2. Themes (25 titles) - Requires Claude API key")
    print("3. Both (51 titles)")

    choice = input("\nEnter your choice (1-3): ").strip()

    dry_run_input = input("Dry run? (y/n): ").strip().lower()
    dry_run = dry_run_input == "y"

    # Execute based on choice
    if choice == "1":
        titles = get_titles_missing_overview()
        if titles:
            stats = backfill_overviews(titles, dry_run)
            print_stats(stats, "Overview Backfill")

    elif choice == "2":
        if not ANTHROPIC_API_KEY:
            print("❌ Error: ANTHROPIC_API_KEY not found in .env")
            print("Get your API key from: https://console.anthropic.com/")
            return

        titles = get_titles_missing_themes()
        if titles:
            stats = backfill_themes(titles, dry_run, use_claude=True)
            print_stats(stats, "Theme Generation")

    elif choice == "3":
        # First backfill overviews
        titles_overview = get_titles_missing_overview()
        if titles_overview:
            print("\n📝 STEP 1: Backfilling overviews...")
            stats1 = backfill_overviews(titles_overview, dry_run)
            print_stats(stats1, "Overview Backfill")

        # Then backfill themes
        if ANTHROPIC_API_KEY:
            titles_themes = get_titles_missing_themes()
            if titles_themes:
                print("\n🧠 STEP 2: Generating themes...")
                stats2 = backfill_themes(titles_themes, dry_run, use_claude=True)
                print_stats(stats2, "Theme Generation")
        else:
            print("\n⚠️  Skipping theme generation - ANTHROPIC_API_KEY not found")

    else:
        print("Invalid choice. Exiting.")
        return

    # Reminder
    if not dry_run:
        print(
            "\n⚠️  IMPORTANT: Remember to regenerate content_embedding for updated records!"
        )


if __name__ == "__main__":
    main()
