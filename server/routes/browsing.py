import asyncio
from functools import partial

from fastapi import APIRouter, Query

from ..cache import cached
from ..core import (
    get_album,
    get_album_browse_id,
    get_artist,
    get_artist_albums,
    get_basejs_url,
    get_charts,
    get_explore,
    get_home,
    get_lyrics,
    get_mood_categories,
    get_mood_playlists,
    get_signatureTimestamp,
    get_song,
    get_song_credits,
    get_song_related,
    get_tasteprofile,
    get_user,
    get_user_playlists,
    get_user_videos,
)
from ..sanitizers import sanitize
from ..state import executor

router = APIRouter(prefix="/browsing", tags=["Browsing"])


@router.get(
    "/home",
    summary="Get Home Page",
    response_description="List of music suggestion rows",
)
@cached("home", ttl=300)
async def home(limit: int = 3):
    """
    Get the home page with music suggestions.

    Returns titled rows of music suggestions including artists, albums, songs, and playlists.

    - **limit**: number of rows to return per section (default: 3)
    """
    loop = asyncio.get_running_loop()
    return sanitize(await loop.run_in_executor(executor, partial(get_home, limit)))


@router.get(
    "/tasteprofile",
    summary="Get Taste Profile",
    response_description="Suggested artists from taste profile",
)
@cached("tasteprofile", ttl=300)
async def tasteprofile():
    """
    Fetch suggested artists from taste profile.

    Must be authenticated. Returns artists recommended based on listening history.
    """
    loop = asyncio.get_running_loop()
    return sanitize(await loop.run_in_executor(executor, partial(get_tasteprofile)))


@router.get(
    "/mood-categories",
    summary="Get Mood Categories",
    response_description="List of mood and genre categories",
)
@cached("mood_categories", ttl=1800)
async def mood_categories():
    """
    Fetch "Moods & Genres" categories from YouTube Music.

    Returns a list of categories like "Energetic", "Sad", "Workout", etc.
    """
    loop = asyncio.get_running_loop()
    return sanitize(await loop.run_in_executor(executor, partial(get_mood_categories)))


@router.get(
    "/mood-playlists/{params}",
    summary="Get Mood Playlists",
    response_description="List of playlists for the given mood",
)
@cached("mood_playlists", ttl=600)
async def mood_playlists(params: str):
    """
    Retrieve playlists for a given "Moods & Genres" category.

    - **params**: params obtained from get_mood_categories()
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(executor, partial(get_mood_playlists, params))
    )


@router.get(
    "/explore",
    summary="Get Explore Data",
    response_description="Latest explore data including new releases and trending",
)
@cached("explore", ttl=300)
async def explore():
    """
    Get latest explore data.

    Returns new releases, top songs, moods & genres, trending content, and new videos.
    """
    loop = asyncio.get_running_loop()
    return sanitize(await loop.run_in_executor(executor, partial(get_explore)))


@router.get(
    "/charts",
    summary="Get Charts",
    response_description="Charts data for the specified country",
)
@cached("charts", ttl=600)
async def charts(country: str = "ZZ"):
    """
    Get latest charts data.

    - **country**: ISO 3166-1 Alpha-2 country code (default: "ZZ" for global)
    """
    loop = asyncio.get_running_loop()
    return sanitize(await loop.run_in_executor(executor, partial(get_charts, country)))


@router.get(
    "/artist/{channelId}",
    summary="Get Artist",
    response_description="Artist info with top releases",
)
@cached("artist", ttl=600)
async def artist(channelId: str):
    """
    Get info about an artist and their top releases.

    Returns songs, albums, singles, videos, and related artists.

    - **channelId**: YouTube channel ID of the artist
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(executor, partial(get_artist, channelId))
    )


@router.get(
    "/artist/{channelId}/albums",
    summary="Get Artist Albums",
    response_description="List of artist albums",
)
@cached("artist_albums", ttl=600)
async def artist_albums(
    channelId: str, params: str, limit: int = 100, order: str | None = None
):
    """
    Get the full list of an artist's albums, singles, or shows.

    - **channelId**: YouTube channel ID of the artist
    - **params**: params obtained from get_artist()
    - **limit**: number of albums to return (default: 100)
    - **order**: "Recency", "Popularity", or "Alphabetical order"
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(
            executor, partial(get_artist_albums, channelId, params, limit, order)
        )
    )


@router.get(
    "/user/{channelId}",
    summary="Get User",
    response_description="User page info",
)
@cached("user", ttl=600)
async def user(channelId: str):
    """
    Retrieve a user's page (videos or playlists).

    - **channelId**: YouTube channel ID of the user
    """
    loop = asyncio.get_running_loop()
    return sanitize(await loop.run_in_executor(executor, partial(get_user, channelId)))


@router.get(
    "/user/{channelId}/playlists",
    summary="Get User Playlists",
    response_description="List of user playlists",
)
@cached("user_playlists", ttl=600)
async def user_playlists(channelId: str, params: str):
    """
    Retrieve a list of playlists for a given user.

    - **channelId**: YouTube channel ID of the user
    - **params**: params obtained from get_user()
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(
            executor, partial(get_user_playlists, channelId, params)
        )
    )


@router.get(
    "/user/{channelId}/videos",
    summary="Get User Videos",
    response_description="List of user videos",
)
@cached("user_videos", ttl=600)
async def user_videos(channelId: str, params: str):
    """
    Retrieve a list of videos for a given user.

    - **channelId**: YouTube channel ID of the user
    - **params**: params obtained from get_user()
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(
            executor, partial(get_user_videos, channelId, params)
        )
    )


@router.get(
    "/album-browse-id/{audioPlaylistId}",
    summary="Get Album Browse ID",
    response_description="Album browse ID or null",
)
@cached("album_browse_id", ttl=3600)
async def album_browse_id(audioPlaylistId: str):
    """
    Get an album's browseId from its audioPlaylistId.

    The audioPlaylistId typically starts with "OLAK5uy_".

    - **audioPlaylistId**: audio playlist ID of the album
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(
            executor, partial(get_album_browse_id, audioPlaylistId)
        )
    )


@router.get(
    "/album/{browseId}",
    summary="Get Album",
    response_description="Album info and tracks",
)
@cached("album", ttl=600)
async def album(browseId: str):
    """
    Get information and tracks of an album.

    - **browseId**: browse ID of the album (must start with "MPRE")
    """
    loop = asyncio.get_running_loop()
    return sanitize(await loop.run_in_executor(executor, partial(get_album, browseId)))


@router.get(
    "/song/{videoId}",
    summary="Get Song",
    response_description="Song metadata and streaming info",
)
@cached("song", ttl=300)
async def song(videoId: str, signatureTimestamp: int | None = None):
    """
    Returns metadata and streaming information about a song or video.

    - **videoId**: video ID of the song
    - **signatureTimestamp**: timestamp of the base.js player (from get_signatureTimestamp)
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(
            executor, partial(get_song, videoId, signatureTimestamp)
        )
    )


@router.get(
    "/song/{browseId}/credits",
    summary="Get Song Credits",
    response_description="Song credits info",
)
@cached("song_credits", ttl=3600)
async def song_credits(browseId: str):
    """
    Get credits for a song.

    Returns performed_by, written_by, produced_by, and other credits.

    - **browseId**: browse ID of the song (starts with "MPTC")
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(executor, partial(get_song_credits, browseId))
    )


@router.get(
    "/song/{browseId}/related",
    summary="Get Related Songs",
    response_description="Related content for the song",
)
@cached("song_related", ttl=600)
async def song_related(browseId: str):
    """
    Gets related content for a song.

    Returns content from the "Related" tab of the watch panel.

    - **browseId**: browse ID of the song
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(executor, partial(get_song_related, browseId))
    )


@router.get(
    "/lyrics/{browseId}",
    summary="Get Lyrics",
    response_description="Song lyrics or timed lyrics",
)
@cached("lyrics", ttl=3600)
async def lyrics(browseId: str, timestamps: bool = False):
    """
    Returns lyrics of a song/video.

    - **browseId**: browse ID of the song
    - **timestamps**: return timed lyrics if available (default: false)
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(executor, partial(get_lyrics, browseId, timestamps))
    )


@router.get(
    "/basejs-url",
    summary="Get Base.js URL",
    response_description="URL of the base.js script",
)
@cached("basejs_url", ttl=3600)
async def basejs_url():
    """
    Extract the URL for the base.js script from YouTube Music.

    Used for obtaining signature timestamps.
    """
    loop = asyncio.get_running_loop()
    return sanitize(await loop.run_in_executor(executor, partial(get_basejs_url)))


@router.get(
    "/signature-timestamp",
    summary="Get Signature Timestamp",
    response_description="Signature timestamp integer",
)
@cached("signature_timestamp", ttl=3600)
async def signature_timestamp(url: str | None = None):
    """
    Fetch base.js and parse the signatureTimestamp.

    Used with get_song() for streaming data decryption.

    - **url**: URL of the base.js script (fetched automatically if not provided)
    """
    loop = asyncio.get_running_loop()
    return sanitize(
        await loop.run_in_executor(executor, partial(get_signatureTimestamp, url))
    )
