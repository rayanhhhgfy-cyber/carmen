import asyncio
from functools import partial

from fastapi import APIRouter, Query

from ..core import get_watch_playlist
from ..sanitizers import sanitize
from ..state import executor

router = APIRouter(prefix="/watch", tags=["Watch"])


@router.get(
    "",
    summary="Get Watch Playlist",
    response_description="Watch playlist with tracks, playlistId, lyrics, related",
)
async def watch_playlist(
    videoId: str | None = Query(
        None, description="Video ID to start the playlist with"
    ),
    playlistId: str | None = Query(None, description="Playlist ID to get tracks from"),
    limit: int = Query(25, description="Number of tracks to return"),
    radio: bool = Query(
        False, description="Enable radio mode (auto-generated from seed)"
    ),
    shuffle: bool = Query(False, description="Shuffle the playlist"),
):
    """
    Get a watch list of tracks.

    Returns a dict with keys: "tracks", "playlistId", "lyrics", "related".

    - **videoId**: video ID of the song to start with
    - **playlistId**: playlist ID to get tracks from
    - **limit**: number of tracks (default: 25)
    - **radio**: auto-generate playlist based on seed
    - **shuffle**: randomize track order
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(
            executor,
            partial(get_watch_playlist, videoId, playlistId, limit, radio, shuffle),
        )
    )
