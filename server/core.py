import sys
from pathlib import Path

from ytmusicapi import YTMusic

ytm: YTMusic = None


def init_ytm(browser: str | Path):
    global ytm
    ytm = YTMusic(str(browser))

    return ytm


# ── Browsing ────────────────────────────────────────────────────────────────


def get_home(limit: int = 3):
    """
    Get the home page. Returns titled rows of music suggestions (artists, albums, songs, playlists).

    :param limit: number of rows to return per section

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_home
    """
    return ytm.get_home(limit=limit)


def get_tasteprofile():
    """
    Fetches suggested artists from taste profile.
    Must be authenticated.

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_tasteprofile
    """
    return ytm.get_tasteprofile()


def get_mood_categories():
    """
    Fetch "Moods & Genres" categories from YouTube Music.

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_mood_categories
    """
    return ytm.get_mood_categories()


def get_mood_playlists(params: str):
    """
    Retrieve playlists for a given "Moods & Genres" category.

    :param params: params obtained from get_mood_categories()

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_mood_playlists
    """
    return ytm.get_mood_playlists(params)


def get_explore():
    """
    Get latest explore data: new releases, top songs, moods & genres, trending, new videos.

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_explore
    """
    return ytm.get_explore()


def get_charts(country: str = "ZZ"):
    """
    Get latest charts data: top video playlists, chart artists.

    :param country: ISO 3166-1 Alpha-2 country code. Defaults to "ZZ" (global).

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_charts
    """
    return ytm.get_charts(country)


def get_artist(channelId: str):
    """
    Get info about an artist and their top releases (songs, albums, singles, videos, related).

    :param channelId: channel id of the artist

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_artist
    """
    return ytm.get_artist(channelId)


def get_artist_albums(
    channelId: str, params: str, limit: int | None = 100, order: str | None = None
):
    """
    Get the full list of an artist's albums, singles, or shows.

    :param channelId: channel id of the artist
    :param params: params obtained from get_artist()
    :param limit: number of albums to return
    :param order: order of albums to return. Possible values: "Recency", "Popularity", "Alphabetical order"

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_artist_albums
    """
    return ytm.get_artist_albums(channelId, params, limit, order)


def get_user(channelId: str):
    """
    Retrieve a user's page (videos or playlists).

    :param channelId: channel id of the user

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_user
    """
    return ytm.get_user(channelId)


def get_user_playlists(channelId: str, params: str):
    """
    Retrieve a list of playlists for a given user.

    :param channelId: channel id of the user
    :param params: params obtained from get_user()

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_user_playlists
    """
    return ytm.get_user_playlists(channelId, params)


def get_user_videos(channelId: str, params: str):
    """
    Retrieve a list of videos for a given user.

    :param channelId: channel id of the user
    :param params: params obtained from get_user()

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_user_videos
    """
    return ytm.get_user_videos(channelId, params)


def get_album_browse_id(audioPlaylistId: str):
    """
    Get an album's browseId based on its audioPlaylistId (starting with OLAK5uy_).

    :param audioPlaylistId: audio playlist id of the album

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_album_browse_id
    """
    return ytm.get_album_browse_id(audioPlaylistId)


def get_album(browseId: str):
    """
    Get information and tracks of an album. browseId must start with "MPRE".

    :param browseId: browse id of the album

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_album
    """
    return ytm.get_album(browseId)


def get_song(videoId: str, signatureTimestamp: int | None = None):
    """
    Returns metadata and streaming information about a song or video.

    :param videoId: video id of the song
    :param signatureTimestamp: timestamp of the base.js player. Obtained from get_signatureTimestamp().

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_song
    """
    return ytm.get_song(
        videoId,
        signatureTimestamp if signatureTimestamp else ytm.get_signatureTimestamp(),
    )


def get_song_credits(browseId: str):
    """
    Get credits for a song (performed_by, written_by, produced_by, etc.).

    :param browseId: browse id of the song (starts with "MPTC")

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_song_credits
    """
    return ytm.get_song_credits(browseId)


def get_song_related(browseId: str):
    """
    Gets related content for a song (from the "Related" tab of the watch panel).

    :param browseId: browse id of the song

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_song_related
    """
    return ytm.get_song_related(browseId)


def get_lyrics(browseId: str, timestamps: bool | None = False):
    """
    Returns lyrics of a song/video.

    :param browseId: browse id of the song
    :param timestamps: return timed lyrics if available

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_lyrics
    """
    return ytm.get_lyrics(browseId, timestamps)


def get_basejs_url():
    """
    Extract the URL for the base.js script from YouTube Music.

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_basejs_url
    """
    return ytm.get_basejs_url()


def get_signatureTimestamp(url: str | None = None):
    """
    Fetch base.js and parse the signatureTimestamp for use with get_song.

    :param url: URL of the base.js script. If not provided, will be fetched automatically.

    https://ytmusicapi.readthedocs.io/en/stable/reference/browsing.html#ytmusicapi.YTMusic.get_signatureTimestamp
    """
    return ytm.get_signatureTimestamp(url)


# ── Search ──────────────────────────────────────────────────────────────────


def search(
    query: str,
    filter: str | None = None,
    scope: str | None = None,
    limit: int = 20,
    ignore_spelling: bool = False,
):
    """
    Search YouTube Music.

    :param query: search query
    :param filter: filter for search results. Possible values: "songs", "videos", "albums", "artists", "playlists", "community_playlists", "featured_playlists", "profiles", "podcasts", "episodes"
    :param scope: scope of search. Possible values: "uploads", "library"
    :param limit: number of results to return
    :param ignore_spelling: ignore spelling suggestions and return the actual results for the entered query

    https://ytmusicapi.readthedocs.io/en/stable/reference/search.html#ytmusicapi.YTMusic.search
    """
    return ytm.search(query, filter, scope, limit, ignore_spelling)


def get_search_suggestions(query: str, detailed_runs: bool = False):
    """
    Get search suggestions.

    :param query: search query
    :param detailed_runs: return detailed runs with feedback tokens

    https://ytmusicapi.readthedocs.io/en/stable/reference/search.html#ytmusicapi.YTMusic.get_search_suggestions
    """
    return ytm.get_search_suggestions(query, detailed_runs)


# ── Watch ───────────────────────────────────────────────────────────────────


def get_watch_playlist(
    videoId: str | None = None,
    playlistId: str | None = None,
    limit: int = 25,
    radio: bool = False,
    shuffle: bool = False,
):
    """
    Get a watch list of tracks.

    :param videoId: video id of the song to start the playlist with
    :param playlistId: playlist id to get tracks from
    :param limit: number of tracks to return
    :param radio: enable radio mode (auto-generated playlist based on a seed)
    :param shuffle: shuffle the playlist

    Returns dict with keys: "tracks", "playlistId", "lyrics", "related"

    https://ytmusicapi.readthedocs.io/en/stable/reference/watch.html#ytmusicapi.YTMusic.get_watch_playlist
    """
    return ytm.get_watch_playlist(videoId, playlistId, limit, radio, shuffle)


# ── Podcasts ────────────────────────────────────────────────────────────────


def get_channel(channelId: str):
    """
    Get info about a podcast channel (episodes, podcasts). Max 10 episodes returned.

    :param channelId: channel id of the podcast

    https://ytmusicapi.readthedocs.io/en/stable/reference/podcasts.html#ytmusicapi.YTMusic.get_channel
    """
    return ytm.get_channel(channelId)


def get_channel_episodes(channelId: str, params: str):
    """
    Get all channel episodes.

    :param channelId: channel id of the podcast
    :param params: params obtained from get_channel()

    https://ytmusicapi.readthedocs.io/en/stable/reference/podcasts.html#ytmusicapi.YTMusic.get_channel_episodes
    """
    return ytm.get_channel_episodes(channelId, params)


def get_podcast(playlistId: str, limit: int | None = 100):
    """
    Returns podcast metadata and episodes.

    :param playlistId: playlist id of the podcast
    :param limit: number of episodes to return

    https://ytmusicapi.readthedocs.io/en/stable/reference/podcasts.html#ytmusicapi.YTMusic.get_podcast
    """
    return ytm.get_podcast(playlistId, limit)


def get_episode(videoId: str):
    """
    Retrieve episode data for a single episode.

    :param videoId: video id or browse id (MPED..) of the episode

    https://ytmusicapi.readthedocs.io/en/stable/reference/podcasts.html#ytmusicapi.YTMusic.get_episode
    """
    return ytm.get_episode(videoId)


# ── Playlists ───────────────────────────────────────────────────────────────


def get_playlist(
    playlistId: str,
    limit: int | None = 100,
    related: bool = False,
    suggestions_limit: int = 0,
):
    """
    Returns a list of playlist items with metadata (title, author, tracks, etc.).

    :param playlistId: playlist id
    :param limit: number of items to return
    :param related: return related playlists
    :param suggestions_limit: number of suggestions to return

    https://ytmusicapi.readthedocs.io/en/stable/reference/playlists.html#ytmusicapi.YTMusic.get_playlist
    """
    return ytm.get_playlist(playlistId, limit, related, suggestions_limit)


# ── Streaming ──────────────────────────────────────────────────────────────

import subprocess
import tempfile
import time
from datetime import datetime
from urllib.parse import parse_qs, urlparse


def get_stream_url(video_id: str) -> str:
    """
    Use yt-dlp to resolve a direct streaming URL for a given YouTube Music video ID.

    :param video_id: YouTube video ID
    :raises subprocess.CalledProcessError: if yt-dlp fails
    :raises FileNotFoundError: if yt-dlp is not installed
    """
    url = f"https://music.youtube.com/watch?v={video_id}"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "yt_dlp",
            "--quiet",
            "--no-warnings",
            "--js-runtimes",
            "bun",
            "--cookies",
            "server/cookies.txt",
            "-f",
            "bestaudio",
            "-g",
            "-x",
            url,
        ],
        capture_output=True,
        text=True,
        check=True,
    )

    stream_url = result.stdout.strip()
    if not stream_url:
        raise ValueError(f"yt-dlp returned no URL for video {video_id}")

    return stream_url


def get_stream_url_ttl(stream_url: str) -> int:
    """
    Parse the `expire` query param from a googlevideo URL and return the
    number of seconds until it expires (with a 60-second safety margin).
    Falls back to 300s (5 min) if parsing fails.
    """
    try:
        parsed = urlparse(stream_url)
        query_params = parse_qs(parsed.query)
        expire_ts = query_params.get("expire", [None])[0]
        if expire_ts:
            ttl = int(expire_ts) - int(time.time()) - 60
            return max(ttl, 60)
    except Exception:
        pass
    return 300


def download_audio(video_id: str, stream_url: str) -> str:
    """
    Download the audio from the resolved URL to a temporary .webm file.
    Returns the file path. Caller is responsible for cleanup.
    """
    tmp = tempfile.NamedTemporaryFile(
        suffix=".webm", prefix=f"{video_id}_", delete=False
    )
    tmp.close()

    subprocess.run(
        [
            sys.executable,
            "-m",
            "yt_dlp",
            "--quiet",
            "--no-warnings",
            "--js-runtimes",
            "bun",
            "--cookies",
            "server/cookies.txt",
            "-f",
            "bestaudio",
            "-x",
            "--no-part",
            "-o",
            tmp.name,
            stream_url,
        ],
        capture_output=True,
        text=True,
        check=True,
    )

    return tmp.name
