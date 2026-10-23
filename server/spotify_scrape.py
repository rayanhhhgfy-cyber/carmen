"""
Zero-setup Spotify playlist reader.

Reads a playlist's public embed page (``open.spotify.com/embed/playlist/<id>``),
which ships the track list as embedded JSON — no ``SPOTIFY_CLIENT_ID`` /
``SPOTIFY_CLIENT_SECRET`` needed. The official API client
(``server/spotify.py``) is preferred whenever credentials are configured
(full pagination, higher rate limits); this is the fallback that makes the
feature work out of the box.

The parser is generalised beyond playlists: the embed pages for albums,
tracks and artists ship the same ``__NEXT_DATA__`` entity, whose track list
appears as ``entity.trackList``, ``entity.tracks.items`` / ``entity.tracks``,
or — for a single track — the entity itself. :func:`parse_embed_entity`
handles each shape defensively and fails loudly (``SpotifyApiError``) when
none of them is present, so callers never silently convert half a page.

Caveats: private/deleted entities have no public embed page (surfaced as
not-found), very long playlists may be truncated to what the embed ships,
and the page structure can change — the parser fails loudly
(``SpotifyApiError``) instead of returning garbage.
"""

import json
import re

import httpx

from .spotify import (
    SpotifyApiError,
    SpotifyNotFoundError,
    SpotifyPlaylist,
    SpotifyTrack,
    parse_spotify_playlist_url,
)

EMBED_URL = "https://open.spotify.com/embed/playlist/{playlist_id}"
EMBED_URL_TEMPLATE = "https://open.spotify.com/embed/{kind}/{entity_id}"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)

_LAYOUT_ERROR = (
    "Spotify changed its public page layout — the data couldn't be read. "
    "Configure SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET for the official "
    "API instead."
)


def _track_id(uri: str) -> str:
    """``spotify:track:<id>`` -> ``<id>`` (falls back to the raw value)."""
    return uri.rsplit(":", 1)[-1] if uri else ""


def _extract_entity(html: str) -> dict:
    """The ``__NEXT_DATA__`` entity dict of an embed page, or raise."""
    match = _NEXT_DATA_RE.search(html)
    if not match:
        raise SpotifyApiError(_LAYOUT_ERROR)
    try:
        payload = json.loads(match.group(1))
        entity = payload["props"]["pageProps"]["state"]["data"]["entity"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise SpotifyApiError(_LAYOUT_ERROR) from exc
    if not isinstance(entity, dict):
        raise SpotifyApiError(_LAYOUT_ERROR)
    return entity


def _largest_image(images) -> str | None:
    if not isinstance(images, list) or not images:
        return None
    best, best_area = None, -1
    for img in images:
        if not isinstance(img, dict) or not img.get("url"):
            continue
        area = (img.get("height") or 0) * (img.get("width") or 0)
        if area > best_area:
            best_area, best = area, img["url"]
    return best


def _entity_artwork(entity: dict) -> str | None:
    sources = (entity.get("coverArt") or {}).get("sources") or []
    if sources and isinstance(sources[0], dict) and sources[0].get("url"):
        return sources[0]["url"]
    artwork = _largest_image(entity.get("images"))
    if artwork:
        return artwork
    album = entity.get("album")
    if isinstance(album, dict):
        return _largest_image(album.get("images"))
    return None


def _entity_description(entity: dict) -> str:
    for attr in entity.get("attributes") or []:
        if isinstance(attr, dict) and attr.get("key") == "description":
            return str(attr.get("value") or "")
    return ""


def _raw_track(
    raw,
    *,
    fallback_album: str = "",
    fallback_artwork: str | None = None,
    fallback_id: str = "",
) -> SpotifyTrack | None:
    """
    One embed/API-shaped raw track dict → :class:`SpotifyTrack`.

    Accepts embed tracks (``uri`` / ``title`` / ``subtitle`` / ``duration``),
    API tracks (``id`` / ``name`` / ``artists[]`` / ``duration_ms`` /
    ``album{…}``) and ``{"track": {…}}`` wrappers.
    """
    if not isinstance(raw, dict):
        return None
    if isinstance(raw.get("track"), dict):
        raw = raw["track"]
    entity_type = raw.get("entityType")
    if entity_type and entity_type != "track":
        return None
    if raw.get("is_local"):
        return None
    uri = str(raw.get("uri") or "")
    track_id = str(raw.get("id") or "") or _track_id(uri) or fallback_id
    if not track_id:
        return None
    title = str(raw.get("title") or raw.get("name") or "").strip()
    if not title:
        return None

    artists: list[str] = []
    raw_artists = raw.get("artists")
    if isinstance(raw_artists, list):
        for artist in raw_artists:
            if isinstance(artist, dict) and artist.get("name"):
                artists.append(str(artist["name"]).strip())
            elif isinstance(artist, str) and artist.strip():
                artists.append(artist.strip())
    if not artists:
        subtitle = str(raw.get("subtitle") or "").strip()
        if subtitle:
            artists = [subtitle]
        elif isinstance(raw.get("artist"), str) and raw["artist"].strip():
            artists = [raw["artist"].strip()]

    album_obj = raw.get("album") if isinstance(raw.get("album"), dict) else {}
    album_name = str(
        album_obj.get("name")
        or (raw.get("album") if isinstance(raw.get("album"), str) else "")
        or fallback_album
    ).strip()
    artwork = _largest_image(album_obj.get("images")) or fallback_artwork

    external_urls = raw.get("external_urls") or {}
    external_ids = raw.get("external_ids") or {}
    return SpotifyTrack(
        id=track_id,
        title=title,
        artists=artists,
        album=album_name,
        album_artwork=artwork,
        duration_ms=int(raw.get("duration_ms") or raw.get("duration") or 0),
        isrc=external_ids.get("isrc") if isinstance(external_ids, dict) else None,
        spotify_url=(
            external_urls.get("spotify")
            if isinstance(external_urls, dict) and external_urls.get("spotify")
            else f"https://open.spotify.com/track/{track_id}"
        ),
        explicit=bool(raw.get("explicit") if "explicit" in raw else raw.get("isExplicit")),
    )


def _entity_raw_tracks(entity: dict) -> list | None:
    """
    The entity's raw track list, whichever shape it ships in.

    Returns ``None`` when the entity carries no track-list shape at all.
    """
    track_list = entity.get("trackList")
    if isinstance(track_list, list):
        return track_list
    tracks = entity.get("tracks")
    if isinstance(tracks, dict) and isinstance(tracks.get("items"), list):
        return tracks["items"]
    if isinstance(tracks, list):
        return tracks
    return None


def parse_embed_entity(html: str, kind: str, entity_id: str) -> SpotifyPlaylist:
    """
    Build a :class:`SpotifyPlaylist` container from any Spotify embed page.

    ``kind`` is one of ``"playlist"`` / ``"album"`` / ``"track"`` /
    ``"artist"``. Raises :class:`SpotifyApiError` when the embedded payload
    is missing or has an unexpected shape.
    """
    entity = _extract_entity(html)
    artwork = _entity_artwork(entity)
    name = str(entity.get("title") or entity.get("name") or "").strip()
    subtitle = str(entity.get("subtitle") or "").strip()

    tracks: list[SpotifyTrack] = []
    if kind == "track":
        single = _raw_track(
            entity, fallback_artwork=artwork, fallback_id=entity_id
        )
        if single is None:
            raise SpotifyApiError(_LAYOUT_ERROR)
        tracks = [single]
        if not name:
            name = single.title
    else:
        raw_tracks = _entity_raw_tracks(entity)
        if raw_tracks is None:
            raise SpotifyApiError(_LAYOUT_ERROR)
        fallback_album = name if kind == "album" else ""
        for raw in raw_tracks:
            track = _raw_track(
                raw,
                fallback_album=fallback_album,
                # An album's tracks share the album cover; a playlist's don't.
                fallback_artwork=artwork if kind == "album" else None,
            )
            if track:
                tracks.append(track)

    owner = subtitle
    if kind == "track" and tracks:
        owner = tracks[0].artist_display
    return SpotifyPlaylist(
        id=entity_id,
        name=name or f"Spotify {kind}",
        description=_entity_description(entity),
        owner=owner,
        artwork=artwork,
        spotify_url=f"https://open.spotify.com/{kind}/{entity_id}",
        tracks=tracks,
    )


def parse_embed_html(html: str, playlist_id: str) -> SpotifyPlaylist:
    """
    Build a :class:`SpotifyPlaylist` from a playlist embed page's HTML.

    Raises :class:`SpotifyApiError` when the embedded payload is missing or
    has an unexpected shape, so callers never silently convert half a page.
    """
    return parse_embed_entity(html, "playlist", playlist_id)


class ScrapedSpotifyClient:
    """
    Drop-in replacement for :class:`SpotifyClient` that needs no credentials.

    Same ``get_playlist(playlist_id)`` contract, same ``Spotify*`` errors, so
    the convert routes don't care which client served the playlist. Album /
    track / artist reads (``get_album`` / ``get_track`` / ``get_artist``)
    follow the same contract against their own embed pages.
    """

    def __init__(self, http: httpx.Client | None = None, timeout: float = 15.0) -> None:
        # The UA rides on the request (not the client) so a caller-supplied
        # httpx.Client keeps its own headers untouched.
        self._http = http or httpx.Client(timeout=timeout)
        self._owns_http = http is None

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def _fetch_html(self, kind: str, entity_id: str) -> str:
        url = (
            EMBED_URL.format(playlist_id=entity_id)
            if kind == "playlist"
            else EMBED_URL_TEMPLATE.format(kind=kind, entity_id=entity_id)
        )
        try:
            response = self._http.get(url, headers={"User-Agent": BROWSER_UA})
        except httpx.HTTPError as exc:
            raise SpotifyApiError(f"Couldn't reach Spotify: {exc}") from exc
        if response.status_code == 404:
            raise SpotifyNotFoundError(
                f"Spotify couldn't find that {kind} — it may be private, "
                "deleted, or the link is wrong."
            )
        if response.status_code != 200:
            raise SpotifyApiError(
                f"Spotify answered with HTTP {response.status_code} while "
                f"reading the {kind} page."
            )
        return response.text

    def get_playlist(self, playlist_id: str) -> SpotifyPlaylist:
        return parse_embed_html(self._fetch_html("playlist", playlist_id), playlist_id)

    def get_album(self, album_id: str) -> SpotifyPlaylist:
        return parse_embed_entity(self._fetch_html("album", album_id), "album", album_id)

    def get_track(self, track_id: str) -> SpotifyPlaylist:
        return parse_embed_entity(self._fetch_html("track", track_id), "track", track_id)

    def get_artist(self, artist_id: str) -> SpotifyPlaylist:
        return parse_embed_entity(
            self._fetch_html("artist", artist_id), "artist", artist_id
        )


def resolve_playlist_id(url: str) -> str:
    """Parse any accepted Spotify playlist reference to its bare id."""
    return parse_spotify_playlist_url(url)
