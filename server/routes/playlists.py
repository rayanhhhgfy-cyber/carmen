import asyncio
from functools import partial

from fastapi import APIRouter, Query

from ..cache import cached
from ..core import get_playlist
from ..sanitizers import sanitized
from ..state import executor

router = APIRouter(prefix="/playlists", tags=["Playlists"])


@router.get(
    "/{playlistId}",
    summary="Get Playlist",
    response_description="Playlist metadata and tracks",
)
@sanitized
@cached("playlist", ttl=300)
async def playlist(
    playlistId: str,
    limit: int = Query(100, description="Number of items to return"),
    related: bool = Query(False, description="Include related playlists"),
    suggestions_limit: int = Query(0, description="Number of suggestions to return"),
):
    """
    Returns a list of playlist items with metadata.

    Includes title, author, description, tracks, and more.

    - **playlistId**: YouTube playlist ID
    - **limit**: max items (default: 100)
    - **related**: include related playlists
    - **suggestions_limit**: number of suggestions (default: 0)
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, partial(get_playlist, playlistId, limit, related, suggestions_limit)
    )
