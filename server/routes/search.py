import asyncio
from functools import partial

from fastapi import APIRouter, Query

from ..cache import cached
from ..core import get_search_suggestions, search
from ..sanitizers import sanitized
from ..state import executor

router = APIRouter(prefix="/search", tags=["Search"])


@router.get(
    "",
    summary="Search YouTube Music",
    response_description="Search results",
)
@sanitized
@cached("search", ttl=3600)
async def search_music(
    query: str = Query(..., description="Search query"),
    filter: str | None = Query(
        None,
        description="Filter: songs, videos, albums, artists, playlists, community_playlists, featured_playlists, profiles, podcasts, episodes",
    ),
    scope: str | None = Query(None, description="Scope: uploads, library"),
    limit: int = Query(20, description="Number of results to return"),
    ignore_spelling: bool = Query(False, description="Ignore spelling suggestions"),
):
    """
    Search YouTube Music.

    Returns a list of matching songs, videos, albums, artists, or playlists.

    - **query**: search query string
    - **filter**: filter results by type
    - **scope**: search within uploads or library
    - **limit**: max results (default: 20)
    - **ignore_spelling**: return exact query results even if misspelled
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, partial(search, query, filter, scope, limit, ignore_spelling)
    )


@router.get(
    "/suggestions",
    summary="Get Search Suggestions",
    response_description="Search suggestions list",
)
@sanitized
@cached("search_suggestions", ttl=600)
async def search_suggestions(
    query: str = Query(..., description="Search query"),
    detailed_runs: bool = Query(
        False, description="Return detailed runs with feedback tokens"
    ),
):
    """
    Get search suggestions for a query.

    Returns autocomplete suggestions as you type.

    - **query**: search query string
    - **detailed_runs**: return dicts with text, runs, fromHistory, feedbackToken
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, partial(get_search_suggestions, query, detailed_runs)
    )
