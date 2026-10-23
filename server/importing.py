"""
Universal import — classify and resolve Spotify / Apple Music / YouTube
links into one common shape, whatever the source.

Classification (:func:`classify_import_url`) recognises:

- ``spotify-playlist`` / ``spotify-album`` / ``spotify-track`` /
  ``spotify-artist`` — ``open.spotify.com`` links (locale prefixes, query
  strings), ``spotify:`` URIs, and a bare 22-char id (a playlist, matching
  the long-standing playlist-only behaviour);
- ``apple-album`` / ``apple-playlist`` — ``music.apple.com`` links;
- ``youtube-video`` / ``youtube-playlist`` — ``music.youtube.com`` /
  ``youtube.com`` watch & playlist links and ``youtu.be`` short links
  (a watch URL is a *video*, even when it also carries a ``list`` param).

Resolution (:func:`resolve_import`) returns
``{"source": {...}, "tracks": [...]}`` where ``source`` is
``{kind, id, name, owner, artwork, url, track_count}`` and every track is
``{id, title, artists, artist, album, artwork, duration_ms, url, explicit,
isrc}``. Resolvers are plain sync functions — the routes run them on the
shared executor like every other blocking call.

Sources:

- Spotify goes through the official client when credentials are configured,
  else the embed-page scraper — both expose album/track/artist reads with
  the playlist container contract.
- Apple albums resolve through the public iTunes Lookup API. **Apple Music
  playlists cannot be resolved**: Apple exposes no playlist contents
  without a paid developer token, so they are classified and then rejected
  with a precise, actionable error (see :class:`ImportUnsupportedError`).
- YouTube resolves through ``server.core`` (``get_playlist`` /
  ``get_track``); its tracks additionally carry ``videoId`` and
  ``thumbnails`` so the convert route can emit them as already-matched
  YouTube Music items without a second lookup.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

import httpx

from . import core
from .filters import parse_duration_seconds
from .spotify import SpotifyClient, SpotifyPlaylist, SpotifyTrack, spotify_configured
from .spotify_scrape import ScrapedSpotifyClient

__all__ = [
    "ImportFailure",
    "ImportNotFoundError",
    "ImportUnsupportedError",
    "ImportUpstreamError",
    "ImportUrlError",
    "classify_import_url",
    "resolve_import",
    "resolve_apple_album",
    "resolve_spotify",
    "resolve_youtube_playlist",
    "resolve_youtube_video",
]


# ── errors ────────────────────────────────────────────────────────────────


class ImportFailure(Exception):
    """Base class for every universal-import failure."""


class ImportUrlError(ImportFailure, ValueError):
    """The pasted value is not a link Carmen can import (→ HTTP 400)."""


class ImportUnsupportedError(ImportFailure):
    """Recognised link, but the source cannot be read (→ HTTP 400)."""


class ImportNotFoundError(ImportFailure):
    """The source entity does not exist / is not public (→ HTTP 404)."""


class ImportUpstreamError(ImportFailure):
    """The source service failed or answered nonsense (→ HTTP 502)."""


APPLE_PLAYLIST_MESSAGE = (
    "Apple Music playlists can't be read without an Apple developer token — "
    "Carmen doesn't have one. Import an Apple Music album link instead, or "
    "use a Spotify or YouTube link for this playlist."
)

_BAD_URL_MESSAGE = (
    "That doesn't look like a Spotify, Apple Music or YouTube link Carmen "
    "can import. Copy the share link from the app and paste it here."
)


# ── classification ────────────────────────────────────────────────────────

_SPOTIFY_URI_RE = re.compile(
    r"^spotify:(playlist|album|track|artist):([A-Za-z0-9]{22})$", re.IGNORECASE
)
_SPOTIFY_URL_RE = re.compile(
    r"^(?:https?://)?open\.spotify\.com/(?:intl-[a-z-]+/)?"
    r"(playlist|album|track|artist)/([A-Za-z0-9]{22})(?:[?#/].*)?$",
    re.IGNORECASE,
)
_BARE_SPOTIFY_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")
_APPLE_URL_RE = re.compile(
    r"^(?:https?://)?music\.apple\.com/(?:[a-z]{2}/)?"
    r"(album|playlist)/(?:[^/]+/)?(pl\.[A-Za-z0-9._\-]+|\d+)(?:[?#/].*)?$",
    re.IGNORECASE,
)
_BARE_APPLE_PLAYLIST_RE = re.compile(r"^pl\.[A-Za-z0-9._\-]+$")
_YOUTUBE_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YOUTUBE_PLAYLIST_ID_RE = re.compile(r"^(?:PL|OLAK5uy_|UU|LL|RD)[A-Za-z0-9_-]{8,}$")
_YOUTUBE_HOSTS = {"music.youtube.com", "youtube.com", "www.youtube.com", "m.youtube.com"}
_YOUTUBE_SHORT_HOSTS = {"youtu.be", "www.youtu.be"}


def classify_import_url(value: str) -> tuple[str, str]:
    """
    Classify a pasted link / URI / bare id into ``(kind, id)``.

    Kinds: ``spotify-playlist``, ``spotify-album``, ``spotify-track``,
    ``spotify-artist``, ``apple-album``, ``apple-playlist``,
    ``youtube-video``, ``youtube-playlist``.

    Raises :class:`ImportUrlError` for anything unrecognised.
    """
    text = (value or "").strip()
    if not text:
        raise ImportUrlError("Paste a Spotify, Apple Music or YouTube link first.")

    match = _SPOTIFY_URI_RE.match(text)
    if match:
        return f"spotify-{match.group(1).lower()}", match.group(2)
    match = _SPOTIFY_URL_RE.match(text)
    if match:
        return f"spotify-{match.group(1).lower()}", match.group(2)

    match = _APPLE_URL_RE.match(text)
    if match:
        kind, entity_id = match.group(1).lower(), match.group(2)
        if kind == "album" and entity_id.isdigit():
            return "apple-album", entity_id
        if kind == "playlist":
            return "apple-playlist", entity_id
        raise ImportUrlError(_BAD_URL_MESSAGE)

    youtube = _classify_youtube(text)
    if youtube is not None:
        return youtube

    # Bare ids, where the shape is unambiguous enough.
    if _BARE_SPOTIFY_ID_RE.match(text):
        return "spotify-playlist", text
    if _BARE_APPLE_PLAYLIST_RE.match(text):
        return "apple-playlist", text
    if _YOUTUBE_VIDEO_ID_RE.match(text):
        return "youtube-video", text
    if _YOUTUBE_PLAYLIST_ID_RE.match(text):
        return "youtube-playlist", text

    raise ImportUrlError(_BAD_URL_MESSAGE)


def _classify_youtube(text: str) -> tuple[str, str] | None:
    candidate = text if "://" in text else f"https://{text}"
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    query = parse_qs(parsed.query or "")

    if host in _YOUTUBE_SHORT_HOSTS:
        video_id = path.lstrip("/").split("/")[0]
        if _YOUTUBE_VIDEO_ID_RE.match(video_id):
            return "youtube-video", video_id
        return None

    if host not in _YOUTUBE_HOSTS:
        return None
    if path == "/watch":
        video_id = (query.get("v") or [""])[0]
        if _YOUTUBE_VIDEO_ID_RE.match(video_id):
            # A watch URL is a video even when it also carries ?list=.
            return "youtube-video", video_id
        return None
    if path == "/playlist":
        playlist_id = (query.get("list") or [""])[0]
        if playlist_id:
            return "youtube-playlist", playlist_id
        return None
    return None


# ── common-shape helpers ──────────────────────────────────────────────────


def _source(kind: str, id: str, name: str, owner: str, artwork, url: str, count: int) -> dict:
    return {
        "kind": kind,
        "id": id,
        "name": name,
        "owner": owner,
        "artwork": artwork,
        "url": url,
        "track_count": count,
    }


def _track(
    *,
    id: str,
    title: str,
    artists: list[str],
    album: str | None,
    artwork: str | None,
    duration_ms: int | None,
    url: str,
    explicit: bool,
    isrc: str | None,
    extra: dict | None = None,
) -> dict:
    track = {
        "id": id,
        "title": title,
        "artists": artists,
        "artist": ", ".join(artists) if artists else "Unknown artist",
        "album": album,
        "artwork": artwork,
        "duration_ms": duration_ms,
        "url": url,
        "explicit": bool(explicit),
        "isrc": isrc,
    }
    if extra:
        track.update(extra)
    return track


# ── Spotify ───────────────────────────────────────────────────────────────


def _spotify_client() -> SpotifyClient | ScrapedSpotifyClient:
    if spotify_configured():
        return SpotifyClient()
    return ScrapedSpotifyClient()


def _spotify_track_dict(track: SpotifyTrack) -> dict:
    return _track(
        id=track.id,
        title=track.title,
        artists=list(track.artists),
        album=track.album or None,
        artwork=track.album_artwork,
        duration_ms=track.duration_ms or None,
        url=track.spotify_url or f"https://open.spotify.com/track/{track.id}",
        explicit=track.explicit,
        isrc=track.isrc,
    )


def resolve_spotify(kind: str, entity_id: str) -> dict:
    """Resolve any Spotify entity kind to the common shape."""
    entity = kind.removeprefix("spotify-")
    client = _spotify_client()
    try:
        if entity == "playlist":
            container: SpotifyPlaylist = client.get_playlist(entity_id)
        elif entity == "album":
            container = client.get_album(entity_id)
        elif entity == "track":
            container = client.get_track(entity_id)
        elif entity == "artist":
            container = client.get_artist(entity_id)
        else:  # classify_import_url never produces this
            raise ImportUrlError(_BAD_URL_MESSAGE)
    finally:
        client.close()
    tracks = [_spotify_track_dict(track) for track in container.tracks]
    owner = container.owner or (container.name if entity == "artist" else "")
    source = _source(
        kind,
        container.id or entity_id,
        container.name,
        owner,
        container.artwork,
        container.spotify_url or f"https://open.spotify.com/{entity}/{entity_id}",
        len(tracks),
    )
    return {"source": source, "tracks": tracks}


# ── Apple Music (iTunes Lookup) ───────────────────────────────────────────

ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup"


def _upgrade_artwork(url: str | None) -> str | None:
    if not url:
        return None
    return url.replace("100x100bb", "600x600bb")


def resolve_apple_album(collection_id: str) -> dict:
    """Resolve an Apple Music album through the public iTunes Lookup API."""
    try:
        response = httpx.get(
            ITUNES_LOOKUP_URL,
            params={"id": collection_id, "entity": "song"},
            headers={"User-Agent": "Carmen/1.0"},
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        raise ImportUpstreamError(f"Could not reach Apple Music: {exc}") from exc
    if response.status_code == 404:
        raise ImportNotFoundError("Apple Music couldn't find that album.")
    if response.status_code != 200:
        raise ImportUpstreamError(
            f"Apple Music lookup failed (HTTP {response.status_code})."
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise ImportUpstreamError("Apple Music returned an unreadable answer.") from exc

    results = payload.get("results") or []
    if not results or not isinstance(results[0], dict):
        raise ImportNotFoundError(
            "Apple Music couldn't find that album — the link may be wrong "
            "or the album isn't available in the US storefront."
        )
    collection = results[0]
    album_name = collection.get("collectionName") or "Apple Music album"
    album_artist = collection.get("artistName") or ""
    album_artwork = _upgrade_artwork(collection.get("artworkUrl100"))

    tracks: list[dict] = []
    for item in results[1:]:
        if not isinstance(item, dict) or item.get("wrapperType") != "track":
            continue
        title = (item.get("trackName") or "").strip()
        track_id = item.get("trackId")
        if not title or track_id is None:
            continue
        artist_name = (item.get("artistName") or album_artist).strip()
        tracks.append(
            _track(
                id=str(track_id),
                title=title,
                artists=[artist_name] if artist_name else [],
                album=item.get("collectionName") or album_name,
                artwork=_upgrade_artwork(item.get("artworkUrl100")) or album_artwork,
                duration_ms=int(item["trackTimeMillis"])
                if item.get("trackTimeMillis")
                else None,
                url=item.get("trackViewUrl") or collection.get("collectionViewUrl") or "",
                explicit=item.get("trackExplicitness") == "explicit",
                isrc=None,  # the public lookup does not expose ISRCs
            )
        )

    source = _source(
        "apple-album",
        str(collection.get("collectionId") or collection_id),
        album_name,
        album_artist,
        album_artwork,
        collection.get("collectionViewUrl")
        or f"https://music.apple.com/us/album/{collection_id}",
        len(tracks),
    )
    return {"source": source, "tracks": tracks}


def resolve_apple_playlist(playlist_id: str) -> dict:
    """Apple Music playlists are classified but cannot be resolved."""
    raise ImportUnsupportedError(APPLE_PLAYLIST_MESSAGE)


# ── YouTube / YouTube Music ───────────────────────────────────────────────


def _ytm_artist_names(item: dict) -> list[str]:
    artists = item.get("artists")
    names: list[str] = []
    if isinstance(artists, list):
        for artist in artists:
            if isinstance(artist, dict) and artist.get("name"):
                names.append(str(artist["name"]).strip())
            elif isinstance(artist, str) and artist.strip():
                names.append(artist.strip())
    elif isinstance(artists, str) and artists.strip():
        names.append(artists.strip())
    if not names and isinstance(item.get("artist"), str) and item["artist"].strip():
        names.append(item["artist"].strip())
    return [name for name in names if name]


def _ytm_album_name(item: dict) -> str | None:
    album = item.get("album")
    if isinstance(album, dict):
        return album.get("name") or None
    if isinstance(album, str) and album.strip():
        return album.strip()
    return None


def _ytm_artwork(item: dict) -> str | None:
    if isinstance(item.get("artwork"), str) and item["artwork"]:
        return item["artwork"]
    thumbnails = item.get("thumbnails")
    if isinstance(thumbnails, list) and thumbnails:
        best, best_area = None, -1
        for thumb in thumbnails:
            if not isinstance(thumb, dict) or not thumb.get("url"):
                continue
            area = (thumb.get("width") or 0) * (thumb.get("height") or 0)
            if area > best_area:
                best_area, best = area, thumb["url"]
        if best:
            return best
    if isinstance(item.get("thumbnail"), str) and item["thumbnail"]:
        return item["thumbnail"]
    return None


def _ytm_duration_ms(item: dict) -> int | None:
    seconds = parse_duration_seconds(item.get("duration_seconds"))
    if seconds is None:
        seconds = parse_duration_seconds(item.get("duration"))
    return seconds * 1000 if seconds is not None else None


def _ytm_track_dict(item: dict) -> dict | None:
    video_id = item.get("videoId")
    title = (item.get("title") or "").strip()
    if not video_id or not title:
        return None
    thumbnails = item.get("thumbnails") if isinstance(item.get("thumbnails"), list) else []
    return _track(
        id=str(video_id),
        title=title,
        artists=_ytm_artist_names(item),
        album=_ytm_album_name(item),
        artwork=_ytm_artwork(item),
        duration_ms=_ytm_duration_ms(item),
        url=f"https://music.youtube.com/watch?v={video_id}",
        explicit=bool(item.get("isExplicit")),
        isrc=None,
        # The item is already a YouTube Music item: keep what the convert
        # route (and the client's track pipeline) needs to emit it as a
        # ready-made match.
        extra={"videoId": str(video_id), "thumbnails": thumbnails},
    )


def _ytm_owner(data: dict) -> str:
    author = data.get("author")
    if isinstance(author, dict):
        return str(author.get("name") or "")
    if isinstance(author, str):
        return author
    return ""


def resolve_youtube_playlist(playlist_id: str, limit: int = 500) -> dict:
    """Resolve a YouTube Music playlist via ``core.get_playlist``."""
    data = core.get_playlist(playlist_id, limit)
    if not data or not isinstance(data, dict):
        raise ImportNotFoundError("YouTube Music couldn't find that playlist.")
    tracks: list[dict] = []
    for item in data.get("tracks") or []:
        if isinstance(item, dict):
            track = _ytm_track_dict(item)
            if track:
                tracks.append(track)
    source = _source(
        "youtube-playlist",
        playlist_id,
        data.get("title") or "YouTube Music playlist",
        _ytm_owner(data),
        _ytm_artwork(data),
        f"https://music.youtube.com/playlist?list={playlist_id}",
        data.get("trackCount") if isinstance(data.get("trackCount"), int) else len(tracks),
    )
    return {"source": source, "tracks": tracks}


def resolve_youtube_video(video_id: str) -> dict:
    """Resolve a single YouTube Music video via ``core.get_track``."""
    data = core.get_track(video_id, None)
    if not data or not isinstance(data, dict):
        raise ImportNotFoundError("YouTube Music couldn't find that video.")
    track = _ytm_track_dict(data)
    if track is None:
        raise ImportNotFoundError("YouTube Music couldn't find that video.")
    source = _source(
        "youtube-video",
        video_id,
        track["title"],
        track["artist"],
        track["artwork"],
        track["url"],
        1,
    )
    return {"source": source, "tracks": [track]}


# ── entry point ───────────────────────────────────────────────────────────


def resolve_import(value: str) -> dict:
    """
    Classify *value* and resolve it to ``{"source": …, "tracks": […]}``.

    Raises :class:`ImportUrlError` (bad link), :class:`ImportUnsupportedError`
    (Apple Music playlist), :class:`ImportNotFoundError`,
    :class:`ImportUpstreamError`, or a ``Spotify*`` error from the Spotify
    resolvers — callers map them to HTTP statuses.
    """
    kind, entity_id = classify_import_url(value)
    if kind.startswith("spotify-"):
        return resolve_spotify(kind, entity_id)
    if kind == "apple-album":
        return resolve_apple_album(entity_id)
    if kind == "apple-playlist":
        return resolve_apple_playlist(entity_id)
    if kind == "youtube-playlist":
        return resolve_youtube_playlist(entity_id)
    if kind == "youtube-video":
        return resolve_youtube_video(entity_id)
    raise ImportUrlError(_BAD_URL_MESSAGE)  # pragma: no cover - unreachable
