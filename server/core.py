import json
import logging
import re
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

from ytmusicapi import YTMusic

from .filters import (
    MAX_DURATION_SECONDS,
    DurationLimitExceeded,
    duration_of,
    parse_duration_seconds,
)

log = logging.getLogger(__name__)

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


# ── Track enrichment ───────────────────────────────────────────────────────

_GENRE_HINT = re.compile(r"\bgenres?\b\s*[:\-]\s*([^\n|;]{2,40})", re.IGNORECASE)


def _first_thumbnail(*candidates) -> list:
    """Return the first non-empty thumbnail list found among *candidates*."""
    for candidate in candidates:
        if isinstance(candidate, list) and candidate:
            return candidate
        if isinstance(candidate, dict):
            thumbs = candidate.get("thumbnails")
            if isinstance(thumbs, list) and thumbs:
                return thumbs
    return []


def _format_duration(seconds: int | None) -> str | None:
    if not seconds:
        return None
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def _lookup_genre(title: str, artist: str) -> str | None:
    """
    Best effort genre lookup through the public iTunes Search API.

    YouTube Music itself does not expose a genre for a track, so the lookup is
    attempted server side (cached by the route) with a short timeout and is
    allowed to fail silently.
    """
    if not title:
        return None
    term = quote(f"{artist} {title}".strip())
    request = Request(
        f"https://itunes.apple.com/search?term={term}&entity=song&limit=1",
        headers={"User-Agent": "Samma3ni/1.0"},
    )
    with urlopen(request, timeout=2) as response:
        payload = json.loads(response.read().decode("utf-8") or "{}")
    results = payload.get("results") or []
    if results:
        return results[0].get("primaryGenreName") or None
    return None


def _collect_lyrics(browse_id: str | None) -> dict:
    """Fetch both the synced and the plain lyrics for a lyrics browse id."""
    lyrics = {"browseId": browse_id, "synced": None, "unsynced": None, "source": None}
    if not browse_id:
        return lyrics

    try:
        timed = ytm.get_lyrics(browse_id, timestamps=True)
    except Exception:  # noqa: BLE001
        timed = None
    if timed:
        lyrics["source"] = timed.get("source")
        if timed.get("hasTimestamps"):
            lyrics["synced"] = [
                {
                    "timeMs": int(line.start_time),
                    "endTimeMs": int(line.end_time),
                    "text": line.text,
                }
                for line in timed.get("lyrics") or []
            ]
        else:
            lyrics["unsynced"] = timed.get("lyrics")

    if not lyrics["unsynced"]:
        try:
            plain = ytm.get_lyrics(browse_id, timestamps=False)
        except Exception:  # noqa: BLE001
            plain = None
        if plain:
            lyrics["unsynced"] = plain.get("lyrics")
            lyrics["source"] = lyrics["source"] or plain.get("source")

    return lyrics


def get_track(video_id: str) -> dict:
    """
    Build one fully enriched payload for a single track.

    Combines the watch queue (title, artists, album, year, artwork), the
    player response (microformat / description) and the lyrics endpoint
    (synced + unsynced) so the client gets everything it needs — display,
    playback and the browser side MP3 tagging — from a single request.

    :param video_id: YouTube video ID
    :raises DurationLimitExceeded: if the track is longer than one hour
    """
    watch: dict = {}
    try:
        watch = ytm.get_watch_playlist(videoId=video_id, limit=5) or {}
    except Exception:  # noqa: BLE001
        watch = {}

    queue = watch.get("tracks") or []
    base = next((t for t in queue if t.get("videoId") == video_id), {}) or {}

    song: dict = {}
    try:
        song = ytm.get_song(video_id) or {}
    except Exception:  # noqa: BLE001
        song = {}

    micro = ((song.get("microformat") or {}).get("microformatRenderer")) or {}
    details = song.get("videoDetails") or {}
    description = details.get("shortDescription") or micro.get("description") or ""

    title = base.get("title") or details.get("title") or ""
    artists = base.get("artists") or []
    if not artists and details.get("author"):
        artists = [{"name": details["author"], "id": None}]

    album = base.get("album") or {}
    year = base.get("year") or (micro.get("publishDate") or "")[:4] or None

    seconds = duration_of(base) or parse_duration_seconds(
        details.get("lengthSeconds")
    )
    if seconds and seconds > MAX_DURATION_SECONDS:
        raise DurationLimitExceeded(video_id, seconds)

    artist_name = artists[0]["name"] if artists and artists[0].get("name") else ""
    genre = None
    match = _GENRE_HINT.search(description or "")
    if match:
        genre = match.group(1).strip()
    if not genre:
        try:
            genre = _lookup_genre(title, artist_name)
        except Exception:  # noqa: BLE001
            genre = None
    if not genre:
        genre = micro.get("category")

    return {
        "videoId": video_id,
        "title": title,
        "artists": artists,
        "album": album,
        "year": year,
        "genre": genre,
        "duration": base.get("length")
        or base.get("duration")
        or _format_duration(seconds),
        "duration_seconds": seconds,
        "thumbnails": _first_thumbnail(
            base.get("thumbnail"),
            base.get("thumbnails"),
            details.get("thumbnail"),
            micro.get("thumbnail"),
        ),
        "description": description,
        "isExplicit": base.get("isExplicit", False),
        "lyrics": _collect_lyrics(watch.get("lyrics")),
        "playlistId": watch.get("playlistId"),
        "relatedBrowseId": watch.get("related"),
    }


def _flatten_related(data, into: list) -> list:
    """Collect every song shaped dict found in a nested related payload."""
    if isinstance(data, dict):
        if data.get("videoId") and data.get("title"):
            into.append(data)
        for value in data.values():
            _flatten_related(value, into)
    elif isinstance(data, list):
        for entry in data:
            _flatten_related(entry, into)
    return into


def get_related(video_id: str, limit: int = 25) -> dict:
    """
    Return the contextually related songs for a track.

    Uses, in order, the watch queue (the songs YouTube Music plays next to
    this one), the "Related" watch panel and — as a last resort — the radio
    generated around the track.

    :param video_id: YouTube video ID used as the seed
    :param limit: maximum number of related tracks to return
    """
    tracks: list = []
    seen: set = set()
    watch: dict = {}

    def _add(items):
        for item in items or []:
            if not isinstance(item, dict):
                continue
            item_id = item.get("videoId")
            if not item_id or item_id == video_id or item_id in seen:
                continue
            seen.add(item_id)
            tracks.append(item)

    try:
        watch = ytm.get_watch_playlist(videoId=video_id, limit=limit) or {}
    except Exception:  # noqa: BLE001
        watch = {}
    _add(watch.get("tracks"))

    if watch.get("related"):
        try:
            panel = ytm.get_song_related(watch["related"]) or []
        except Exception:  # noqa: BLE001
            panel = []
        _add(_flatten_related(panel, []))

    if len(tracks) < 5:
        try:
            radio = (
                ytm.get_watch_playlist(videoId=video_id, limit=limit, radio=True) or {}
            )
        except Exception:  # noqa: BLE001
            radio = {}
        _add(radio.get("tracks"))

    return {
        "seed": video_id,
        "tracks": tracks[:limit],
        "playlistId": watch.get("playlistId"),
        "lyrics": watch.get("lyrics"),
    }


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

import threading
import time

from yt_dlp import YoutubeDL

AUDIO_CACHE_DIR = Path(__file__).parent / ".audio_cache"
AUDIO_CACHE_LIMIT = 100  # number of downloaded files kept on disk
AUDIO_SUFFIXES = (".m4a", ".mp4", ".webm", ".ogg", ".opus")

streaming_options = {
    "quiet": False,
    "cookiesfrombrowser": ("chrome", "Default"),
    "verbose": True,
    "js_runtimes": {"deno": {}},
    "format": "bestaudio[ext=m4a]/bestaudio/best",
    "no_warnings": False,
    # "extractor_args": {"youtube": {"player_client": ["web_safari", "web_embedded"]}},
}

_download_locks: dict[str, threading.Lock] = {}
_download_guard = threading.Lock()


def _lock_for(video_id: str) -> threading.Lock:
    """Return the download lock of *video_id*, creating it if needed."""
    with _download_guard:
        lock = _download_locks.get(video_id)
        if lock is None:
            lock = _download_locks[video_id] = threading.Lock()
        return lock


def find_cached_audio(video_id: str) -> Path | None:
    """Return the already downloaded audio file for *video_id*, if any."""
    for suffix in AUDIO_SUFFIXES:
        candidate = AUDIO_CACHE_DIR / f"{video_id}{suffix}"
        if candidate.is_file() and candidate.stat().st_size:
            return candidate
    return None


def _prune_audio_cache():
    """Keep only the most recently used :data:`AUDIO_CACHE_LIMIT` files."""
    try:
        files = sorted(
            (p for p in AUDIO_CACHE_DIR.glob("*") if p.is_file()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for stale in files[AUDIO_CACHE_LIMIT:]:
            stale.unlink(missing_ok=True)
    except OSError:
        pass


def _duration_filter(info_dict, incomplete=False):
    """
    ``match_filter`` passed to yt-dlp: anything longer than one hour is
    rejected *before* yt-dlp starts writing bytes to disk.

    Returning a string makes ``process_info`` skip the download while still
    handing the extracted metadata back to the caller, which then raises
    :class:`DurationLimitExceeded`.
    """
    if incomplete:
        return None
    seconds = parse_duration_seconds((info_dict or {}).get("duration"))
    if seconds and seconds > MAX_DURATION_SECONDS:
        return f"is longer than one hour ({seconds} seconds)"
    return None


def _watch_url(video_id: str) -> str:
    return f"https://music.youtube.com/watch?v={video_id}"


# Player clients tried in order to fetch the audio.
#
# YouTube keeps tightening the default (web) client: stream URLs handed to
# datacenter IPs are regularly rejected with a 403 by the CDN.  The clients
# below were picked because they all expose a real audio-only stream (itag
# 140/m4a) instead of storyboard tiles or muxed video, so a fallback always
# yields a plain audio file.
STREAM_CLIENTS: tuple[str | None, ...] = (
    None,  # yt-dlp's default selection
    "tv_embedded",
    "visionos",
    "chrome",
    "android_music",
    "ios_music",
    "tv_embedded_simply",
)


def _client_options(client: str | None, outtmpl: str) -> dict:
    """yt-dlp options for one download attempt (single extraction + download)."""
    options = {
        **streaming_options,
        "outtmpl": outtmpl,
        "match_filter": _duration_filter,
    }
    if client:
        options["extractor_args"] = {"youtube": {"player_client": [client]}}
    return options


def _cleanup_partials(video_id: str):
    """Remove the half written files left behind by a failed attempt."""
    for stale in AUDIO_CACHE_DIR.glob(f"{video_id}*.part*"):
        stale.unlink(missing_ok=True)
    for stale in AUDIO_CACHE_DIR.glob(f"{video_id}*.ytdl"):
        stale.unlink(missing_ok=True)


_preferred_client: str | None = None


def _client_order() -> list:
    """
    Player clients to try, most likely to work first.

    The last client that successfully served audio is remembered so the next
    song does not have to repeat the failing attempt.
    """
    with _download_guard:
        preferred = _preferred_client
    order = list(STREAM_CLIENTS)
    if preferred in order:
        order.remove(preferred)
        order.insert(0, preferred)
    return order


def _remember_client(client: str | None):
    """Remember the player client that worked, for the next downloads."""
    global _preferred_client
    with _download_guard:
        _preferred_client = client


def get_stream_url(video_id: str) -> str:
    """
    Use yt-dlp to resolve a direct streaming URL for a given YouTube Music video ID.

    :param video_id: YouTube video ID
    :raises DurationLimitExceeded: if the track is longer than one hour
    :raises ValueError: if yt-dlp did not return a URL
    """
    with YoutubeDL(streaming_options) as ydl:
        info = ydl.extract_info(_watch_url(video_id), download=False)

    seconds = parse_duration_seconds(info.get("duration"))
    if seconds and seconds > MAX_DURATION_SECONDS:
        raise DurationLimitExceeded(video_id, seconds)

    stream_url = info.get("url")
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
    except Exception:  # noqa: BLE001, S110
        pass
    return 300


def download_audio(video_id: str) -> str:
    """
    Download the audio of *video_id* on the server with yt-dlp.

    Extraction and download run in a **single** yt-dlp pass over the watch URL
    so the very same request headers are used to resolve and to fetch the
    media.  When a player client is rejected by the CDN (the common 403 on
    datacenter IPs) the next client in :data:`STREAM_CLIENTS` is tried.

    The one hour duration limit is enforced by :func:`_duration_filter` before
    any byte is written, and the finished file lands in the on-disk audio
    cache, so callers always get a local file instead of a remote audio URL.

    Concurrent calls for the same video share a single download.

    :param video_id: YouTube video ID
    :return: path of the cached audio file
    :raises DurationLimitExceeded: if the track is longer than one hour
    """
    AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    cached = find_cached_audio(video_id)
    if cached:
        return str(cached)

    lock = _lock_for(video_id)
    with lock:
        cached = find_cached_audio(video_id)
        if cached:
            return str(cached)

        outtmpl = str(AUDIO_CACHE_DIR / f"{video_id}.%(ext)s")
        produced: Path | None = None
        last_error: Exception | None = None

        for client in _client_order():
            label = client or "default"
            try:
                with YoutubeDL(_client_options(client, outtmpl)) as ydl:
                    info = ydl.extract_info(_watch_url(video_id), download=True) or {}

                seconds = parse_duration_seconds(info.get("duration"))
                if seconds and seconds > MAX_DURATION_SECONDS:
                    # match_filter skipped the download, drop any leftover
                    for leftover in AUDIO_CACHE_DIR.glob(f"{video_id}.*"):
                        leftover.unlink(missing_ok=True)
                    raise DurationLimitExceeded(video_id, seconds)

                candidate = Path(ydl.prepare_filename(info))
                if not candidate.is_file():
                    matches = sorted(
                        AUDIO_CACHE_DIR.glob(f"{video_id}.*"),
                        key=lambda p: p.stat().st_mtime,
                        reverse=True,
                    )
                    if not matches:
                        raise ValueError(
                            f"yt-dlp did not produce an audio file for {video_id}"
                        )
                    candidate = matches[0]

                if candidate.is_file() and candidate.stat().st_size:
                    produced = candidate
                    _remember_client(client)
                    break
            except DurationLimitExceeded:
                raise
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                _cleanup_partials(video_id)
                log.warning(
                    "Audio download for %s failed with the %s client: %s",
                    video_id,
                    label,
                    exc,
                )

        if produced is None:
            raise last_error or ValueError(
                f"yt-dlp did not produce an audio file for {video_id}"
            )

        _prune_audio_cache()

    with _download_guard:
        _download_locks.pop(video_id, None)

    return str(produced)
