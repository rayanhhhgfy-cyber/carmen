import asyncio
from functools import partial

from fastapi import APIRouter, HTTPException

from ..cache import cached
from ..core import (
    LYRICS_PROVIDERS,
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
    get_related,
    get_signatureTimestamp,
    get_song,
    get_song_credits,
    get_song_related,
    get_tasteprofile,
    get_track,
    get_user,
    get_user_playlists,
    get_user_videos,
)
from ..filters import (
    MAX_DURATION_SECONDS,
    DurationLimitExceeded,
    parse_duration_seconds,
)
from ..sanitizers import sanitized
from ..state import executor

router = APIRouter(prefix="/browsing", tags=["Browsing"])


def _guard_duration(result, video_id: str):
    """Reject tracks longer than one hour with an explicit 400."""
    details = (result or {}).get("videoDetails") or {}
    seconds = parse_duration_seconds(details.get("lengthSeconds"))
    if seconds and seconds > MAX_DURATION_SECONDS:
        raise HTTPException(
            status_code=400,
            detail=DurationLimitExceeded(video_id, seconds).args[0],
        )
    return result



@router.get(
    "/home",
    summary="Get Home Page",
    response_description="List of music suggestion rows",
)
@sanitized
@cached("home", ttl=3600)
async def home(limit: int = 3):
    """
    Get the home page with music suggestions.

    Returns titled rows of music suggestions including artists, albums, songs, and playlists.

    - **limit**: number of rows to return per section (default: 3)
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_home, limit))


@router.get(
    "/tasteprofile",
    summary="Get Taste Profile",
    response_description="Suggested artists from taste profile",
)
@sanitized
@cached("tasteprofile", ttl=3600)
async def tasteprofile():
    """
    Fetch suggested artists from taste profile.

    Must be authenticated. Returns artists recommended based on listening history.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_tasteprofile))


@router.get(
    "/mood-categories",
    summary="Get Mood Categories",
    response_description="List of mood and genre categories",
)
@sanitized
@cached("mood_categories", ttl=1800)
async def mood_categories():
    """
    Fetch "Moods & Genres" categories from YouTube Music.

    Returns a list of categories like "Energetic", "Sad", "Workout", etc.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_mood_categories))


@router.get(
    "/mood-playlists/{params}",
    summary="Get Mood Playlists",
    response_description="List of playlists for the given mood",
)
@sanitized
@cached("mood_playlists", ttl=3600)
async def mood_playlists(params: str):
    """
    Retrieve playlists for a given "Moods & Genres" category.

    - **params**: params obtained from get_mood_categories()
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_mood_playlists, params))


@router.get(
    "/explore",
    summary="Get Explore Data",
    response_description="Latest explore data including new releases and trending",
)
@sanitized
@cached("explore", ttl=3600)
async def explore():
    """
    Get latest explore data.

    Returns new releases, top songs, moods & genres, trending content, and new videos.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_explore))


@router.get(
    "/charts",
    summary="Get Charts",
    response_description="Charts data for the specified country",
)
@sanitized
@cached("charts", ttl=3600)
async def charts(country: str = "ZZ"):
    """
    Get latest charts data.

    - **country**: ISO 3166-1 Alpha-2 country code (default: "ZZ" for global)
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_charts, country))


@router.get(
    "/artist/{channelId}",
    summary="Get Artist",
    response_description="Artist info with top releases",
)
@sanitized
@cached("artist", ttl=3600)
async def artist(channelId: str):
    """
    Get info about an artist and their top releases.

    Returns songs, albums, singles, videos, and related artists.

    - **channelId**: YouTube channel ID of the artist
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_artist, channelId))


@router.get(
    "/artist/{channelId}/albums",
    summary="Get Artist Albums",
    response_description="List of artist albums",
)
@sanitized
@cached("artist_albums", ttl=3600)
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
    return await loop.run_in_executor(
        executor, partial(get_artist_albums, channelId, params, limit, order)
    )


@router.get(
    "/user/{channelId}",
    summary="Get User",
    response_description="User page info",
)
@sanitized
@cached("user", ttl=3600)
async def user(channelId: str):
    """
    Retrieve a user's page (videos or playlists).

    - **channelId**: YouTube channel ID of the user
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_user, channelId))


@router.get(
    "/user/{channelId}/playlists",
    summary="Get User Playlists",
    response_description="List of user playlists",
)
@sanitized
@cached("user_playlists", ttl=3600)
async def user_playlists(channelId: str, params: str):
    """
    Retrieve a list of playlists for a given user.

    - **channelId**: YouTube channel ID of the user
    - **params**: params obtained from get_user()
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, partial(get_user_playlists, channelId, params)
    )


@router.get(
    "/user/{channelId}/videos",
    summary="Get User Videos",
    response_description="List of user videos",
)
@sanitized
@cached("user_videos", ttl=3600)
async def user_videos(channelId: str, params: str):
    """
    Retrieve a list of videos for a given user.

    - **channelId**: YouTube channel ID of the user
    - **params**: params obtained from get_user()
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, partial(get_user_videos, channelId, params)
    )


@router.get(
    "/album-browse-id/{audioPlaylistId}",
    summary="Get Album Browse ID",
    response_description="Album browse ID or null",
)
@sanitized
@cached("album_browse_id", ttl=3600)
async def album_browse_id(audioPlaylistId: str):
    """
    Get an album's browseId from its audioPlaylistId.

    The audioPlaylistId typically starts with "OLAK5uy_".

    - **audioPlaylistId**: audio playlist ID of the album
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, partial(get_album_browse_id, audioPlaylistId)
    )


@router.get(
    "/album/{browseId}",
    summary="Get Album",
    response_description="Album info and tracks",
)
@sanitized
@cached("album", ttl=3600)
async def album(browseId: str):
    """
    Get information and tracks of an album.

    - **browseId**: browse ID of the album (must start with "MPRE")
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_album, browseId))


@router.get(
    "/song/{videoId}",
    summary="Get Song",
    response_description="Song metadata and streaming info",
)
@sanitized
@cached("song", ttl=3600)
async def song(videoId: str, signatureTimestamp: int | None = None):
    """
    Returns metadata and streaming information about a song or video.

    - **videoId**: video ID of the song
    - **signatureTimestamp**: timestamp of the base.js player (from get_signatureTimestamp)
    """
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        executor, partial(get_song, videoId, signatureTimestamp)
    )
    return _guard_duration(result, videoId)


@router.get(
    "/track/{videoId}",
    summary="Get Enriched Track",
    response_description="Full track payload: metadata, artwork, genre and lyrics",
)
@sanitized
@cached("track", ttl=3600)
async def track(videoId: str, provider: str | None = None):
    """
    Returns everything the player needs about a track in one call.

    Payload contains title, artists, album, genre, release year, artwork URL
    and both the synced and unsynced lyrics, plus the ids needed to fetch the
    related songs.

    - **videoId**: video ID of the song
    - **provider**: force a lyrics source — one of ``lrclib``, ``musixmatch``,
      ``netease``, ``megalobiz`` or ``genius``. Omit it (or pass ``auto``) to
      keep the default resolution chain.
    """
    if provider in (None, "", "auto"):
        provider = None
    elif provider not in LYRICS_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"unknown lyrics provider {provider!r} "
            f"(expected one of: auto, {', '.join(LYRICS_PROVIDERS)})",
        )
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(executor, partial(get_track, videoId, provider))
    except DurationLimitExceeded as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/related/{videoId}",
    summary="Get Related Songs",
    response_description="Contextually related tracks for the given song",
)
@sanitized
@cached("related", ttl=3600)
async def related(videoId: str, limit: int = 25):
    """
    Returns the songs that belong next to the given one: the watch queue
    (what YouTube Music plays after this track), the "Related" watch panel
    and, as a fallback, the radio generated around the seed.

    Tracks longer than one hour are filtered out.

    - **videoId**: video ID used as the seed
    - **limit**: maximum number of tracks to return (default: 25)
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, partial(get_related, videoId, limit)
    )


@router.get(
    "/song/{browseId}/credits",
    summary="Get Song Credits",
    response_description="Song credits info",
)
@sanitized
@cached("song_credits", ttl=3600)
async def song_credits(browseId: str):
    """
    Get credits for a song.

    Returns performed_by, written_by, produced_by, and other credits.

    - **browseId**: browse ID of the song (starts with "MPTC")
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_song_credits, browseId))


@router.get(
    "/song/{browseId}/related",
    summary="Get Related Songs",
    response_description="Related content for the song",
)
@sanitized
@cached("song_related", ttl=3600)
async def song_related(browseId: str):
    """
    Gets related content for a song.

    Returns content from the "Related" tab of the watch panel.

    - **browseId**: browse ID of the song
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_song_related, browseId))


@router.get(
    "/lyrics/{browseId}",
    summary="Get Lyrics",
    response_description="Song lyrics or timed lyrics",
)
@sanitized
@cached("lyrics", ttl=3600)
async def lyrics(browseId: str, timestamps: bool = False):
    """
    Returns lyrics of a song/video.

    - **browseId**: browse ID of the song
    - **timestamps**: return timed lyrics if available (default: false)
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, partial(get_lyrics, browseId, timestamps)
    )


@router.get(
    "/basejs-url",
    summary="Get Base.js URL",
    response_description="URL of the base.js script",
)
@sanitized
@cached("basejs_url", ttl=3600)
async def basejs_url():
    """
    Extract the URL for the base.js script from YouTube Music.

    Used for obtaining signature timestamps.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_basejs_url))


@router.get(
    "/signature-timestamp",
    summary="Get Signature Timestamp",
    response_description="Signature timestamp integer",
)
@sanitized
@cached("signature_timestamp", ttl=3600)
async def signature_timestamp(url: str | None = None):
    """
    Fetch base.js and parse the signatureTimestamp.

    Used with get_song() for streaming data decryption.

    - **url**: URL of the base.js script (fetched automatically if not provided)
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, partial(get_signatureTimestamp, url))
