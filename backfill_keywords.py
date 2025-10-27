#!/usr/bin/env python3
"""
TMDB Keywords Backfill Script
Fetches keywords from TMDB API and updates Supabase database
"""

import os
import time
import requests
from supabase import create_client, Client
from typing import List, Dict, Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configuration
TMDB_API_KEY = os.getenv("TMDB_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Rate limiting
RATE_LIMIT_DELAY = 0.25  # 4 requests per second (TMDB limit is ~40/sec)

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_tmdb_keywords(tmdb_id: int, kind: str) -> Optional[List[str]]:
    """
    Fetch keywords from TMDB API for a given title

    Args:
        tmdb_id: TMDB ID (stored in your 'id' field)
        kind: 'movie' or 'tv'

    Returns:
        List of keyword strings or None if error
    """
    try:
        # TMDB endpoints differ for movies vs TV shows
        if kind == "movie":
            url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/keywords"
        else:  # tv
            url = f"https://api.themoviedb.org/3/tv/{tmdb_id}/keywords"

        headers = {
            "Authorization": f"Bearer {TMDB_API_KEY}",
            "accept": "application/json"
        }

        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()

        data = response.json()

        # Extract keywords
        if kind == "movie":
            keywords = [kw["name"] for kw in data.get("keywords", [])]
        else:  # tv shows use 'results' instead of 'keywords'
            keywords = [kw["name"] for kw in data.get("results", [])]

        return keywords if keywords else None

    except requests.exceptions.RequestException as e:
        print(f"  ❌ Error fetching TMDB keywords for {kind} {tmdb_id}: {e}")
        return None
    except Exception as e:
        print(f"  ❌ Unexpected error for {kind} {tmdb_id}: {e}")
        return None


def update_keywords_in_db(title_id: int, keywords: List[str]) -> bool:
    """
    Update keywords in Supabase for a given title

    Args:
        title_id: Database ID
        keywords: List of keyword strings

    Returns:
        True if successful, False otherwise
    """
    try:
        response = supabase.table("titles").update({
            "keywords": keywords
        }).eq("id", title_id).execute()

        return True
    except Exception as e:
        print(f"  ❌ Error updating database for title {title_id}: {e}")
        return False


def get_titles_missing_keywords(limit: Optional[int] = None) -> List[Dict]:
    """
    Fetch titles from database that are missing keywords

    Args:
        limit: Maximum number of records to fetch (None for all)

    Returns:
        List of title dictionaries
    """
    try:
        query = supabase.table("titles").select("id, title, kind, popularity").is_("keywords", None)

        if limit:
            query = query.limit(limit)

        # Order by popularity to prioritize important titles
        query = query.order("popularity", desc=True)

        response = query.execute()
        return response.data
    except Exception as e:
        print(f"❌ Error fetching titles from database: {e}")
        return []


def backfill_keywords_batch(titles: List[Dict], dry_run: bool = False) -> Dict[str, int]:
    """
    Backfill keywords for a batch of titles

    Args:
        titles: List of title dictionaries
        dry_run: If True, only fetch but don't update database

    Returns:
        Statistics dictionary
    """
    stats = {
        "total": len(titles),
        "success": 0,
        "no_keywords_found": 0,
        "api_error": 0,
        "db_error": 0
    }

    print(f"\n🚀 Starting backfill for {len(titles)} titles...")
    if dry_run:
        print("🔍 DRY RUN MODE - No database updates will be made\n")

    for i, title in enumerate(titles, 1):
        title_id = title["id"]
        title_name = title["title"]
        kind = title["kind"]
        popularity = title.get("popularity", 0)

        print(f"\n[{i}/{len(titles)}] Processing: {title_name} ({kind}) [ID: {title_id}, Pop: {popularity:.1f}]")

        # Fetch keywords from TMDB
        keywords = fetch_tmdb_keywords(title_id, kind)

        if keywords is None:
            stats["api_error"] += 1
            continue

        if not keywords:
            print(f"  ⚠️  No keywords found on TMDB")
            stats["no_keywords_found"] += 1
            continue

        print(f"  ✅ Found {len(keywords)} keywords: {', '.join(keywords[:5])}{' ...' if len(keywords) > 5 else ''}")

        # Update database
        if not dry_run:
            if update_keywords_in_db(title_id, keywords):
                stats["success"] += 1
                print(f"  💾 Database updated successfully")
            else:
                stats["db_error"] += 1
        else:
            print(f"  🔍 DRY RUN - Would update database with {len(keywords)} keywords")
            stats["success"] += 1

        # Rate limiting
        time.sleep(RATE_LIMIT_DELAY)

    return stats


def print_stats(stats: Dict[str, int]):
    """Print backfill statistics"""
    print("\n" + "="*60)
    print("📊 BACKFILL STATISTICS")
    print("="*60)
    print(f"Total titles processed:     {stats['total']}")
    print(f"✅ Successfully updated:    {stats['success']}")
    print(f"⚠️  No keywords found:       {stats['no_keywords_found']}")
    print(f"❌ API errors:              {stats['api_error']}")
    print(f"❌ Database errors:         {stats['db_error']}")
    print(f"\nSuccess rate: {stats['success'] / stats['total'] * 100:.1f}%")
    print("="*60 + "\n")


def main():
    """Main execution"""
    print("="*60)
    print("🎬 TMDB KEYWORDS BACKFILL TOOL")
    print("="*60)

    # Validate configuration
    if not TMDB_API_KEY:
        print("❌ Error: TMDB_API_KEY not found in environment variables")
        print("Please create a .env file with: TMDB_API_KEY=your_key_here")
        return

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ Error: SUPABASE_URL or SUPABASE_KEY not found in environment variables")
        print("Please create a .env file with your Supabase credentials")
        return

    print("✅ Configuration validated\n")

    # Get user input
    print("Options:")
    print("1. Dry run (top 10 titles) - Test without updating database")
    print("2. Backfill top 50 popular titles")
    print("3. Backfill top 100 popular titles")
    print("4. Backfill ALL missing keywords (814 titles)")

    choice = input("\nEnter your choice (1-4): ").strip()

    # Determine batch size
    if choice == "1":
        limit = 10
        dry_run = True
    elif choice == "2":
        limit = 50
        dry_run = False
    elif choice == "3":
        limit = 100
        dry_run = False
    elif choice == "4":
        limit = None
        dry_run = False
        confirm = input("\n⚠️  This will process ALL 814 titles. Continue? (y/n): ").strip().lower()
        if confirm != "y":
            print("Cancelled.")
            return
    else:
        print("Invalid choice. Exiting.")
        return

    # Fetch titles
    print(f"\n📥 Fetching titles from database...")
    titles = get_titles_missing_keywords(limit=limit)

    if not titles:
        print("✅ No titles missing keywords! Database is clean.")
        return

    print(f"✅ Found {len(titles)} titles missing keywords\n")

    # Backfill keywords
    stats = backfill_keywords_batch(titles, dry_run=dry_run)

    # Print final statistics
    print_stats(stats)

    # Reminder about embedding regeneration
    if stats["success"] > 0 and not dry_run:
        print("⚠️  IMPORTANT: Remember to regenerate metadata_embedding for updated records!")
        print("   Run: UPDATE titles SET metadata_embedding = generate_embedding(...) WHERE keywords IS NOT NULL;")


if __name__ == "__main__":
    main()
