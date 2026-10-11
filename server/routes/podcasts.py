import asyncio
from functools import partial

from fastapi import APIRouter, Query

from ..cache import cached
from ..core import get_channel, get_channel_episodes, get_episode, get_podcast
from ..sanitizers import sanitized
from ..state import executor

router = APIRouter(prefix="/podcasts", tags=["Podcasts"])


@router.get(
    "/channel/{channelId}",
    summary="Get Podcast Channel",
    response_description="Channel info with episodes and podcasts",
)
@sanitized
@cached("podcast_channel", ttl=86400, id_arg="channelId")
async def channel(channelId: str):
    """
    Get info about a podcast channel.

    Returns episodes (max 10) and podcasts from the channel.

    - **channelId**: YouTube channel ID of the podcast
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_channel, channelId))


@router.get(
    "/channel/{channelId}/episodes",
    summary="Get Channel Episodes",
    response_description="List of all channel episodes",
)
@sanitized
@cached("podcast_episodes", ttl=86400, id_arg="channelId", extra_args=("params",))
async def channel_episodes(channelId: str, params: str):
    """
    Get all channel episodes.

    - **channelId**: YouTube channel ID of the podcast
    - **params**: params obtained from get_channel()
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, partial(get_channel_episodes, channelId, params)
    )


@router.get(
    "/podcast/{playlistId}",
    summary="Get Podcast",
    response_description="Podcast metadata and episodes",
)
@sanitized
@cached("podcast", ttl=86400, id_arg="playlistId", extra_args=("limit",))
async def podcast(
    playlistId: str, limit: int = Query(100, description="Number of episodes to return")
):
    """
    Returns podcast metadata and episodes.

    - **playlistId**: playlist ID of the podcast
    - **limit**: max episodes (default: 100)
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_podcast, playlistId, limit))


@router.get(
    "/episode/{videoId}",
    summary="Get Episode",
    response_description="Episode data",
)
@sanitized
@cached("podcast_episode", ttl=86400, id_arg="videoId")
async def episode(videoId: str):
    """
    Retrieve episode data for a single episode.

    - **videoId**: video ID or browse ID (MPED..) of the episode
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_episode, videoId))
