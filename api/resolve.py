"""
Server-free Spotify resolve helper — a Vercel Python function.

``GET /api/resolve?url=<spotify link or URI>`` classifies a Spotify
playlist / album / track / artist link, reads its public embed page
(``open.spotify.com/embed/<kind>/<id>`` — the browser cannot fetch it
itself, CORS) and returns exactly the shape the Carmen server's
``GET /convert/resolve`` returns for Spotify kinds
(``server/importing.py`` + ``server/routes/convert.py``):

    {"source": {"kind", "id", "name", "owner", "artwork", "url",
                "track_count"},
     "tracks": [{"id", "title", "artists", "artist", "album", "artwork",
                 "duration_ms", "url", "explicit", "isrc"}]}

Stdlib only (urllib / json / re) — no requirements.txt. The parsing is a
faithful port of ``server/spotify_scrape.py``'s ``parse_embed_entity``
(entity.trackList, entity.tracks.items / entity.tracks, single-track
self-entity) and the classification mirrors ``server/importing.py``'s
Spotify patterns (``spotify:`` URIs, ``intl-`` prefixes, bare 22-char id
= playlist). Failures are loud JSON errors, never a partial success:
400 for an unrecognised / non-Spotify link, 404 when Spotify has no such
public entity, 502 when the embed page cannot be read or its layout
changed. Every response carries ``Access-Control-Allow-Origin: *``.
"""

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

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
_BAD_URL_MESSAGE = (
    "That doesn't look like a Spotify, Apple Music or YouTube link Carmen "
    "can import. Copy the share link from the app and paste it here."
)

# Mirrors server/importing.py's Spotify classification.
_SPOTIFY_URI_RE = re.compile(
    r"^spotify:(playlist|album|track|artist):([A-Za-z0-9]{22})$", re.IGNORECASE
)
_SPOTIFY_URL_RE = re.compile(
    r"^(?:https?://)?open\.spotify\.com/(?:intl-[a-z-]+/)?"
    r"(playlist|album|track|artist)/([A-Za-z0-9]{22})(?:[?#/].*)?$",
    re.IGNORECASE,
)
_BARE_SPOTIFY_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")


class ResolveError(Exception):
    """A resolve failure carrying its HTTP status."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


# ── classification (server/importing.py) ────────────────────────────────


def classify_spotify(value: str) -> tuple[str, str]:
    """Classify a pasted value into (``spotify-<kind>``, id) or raise 400."""
    text = (value or "").strip()
    if not text:
        raise ResolveError(400, "Paste a Spotify link first.")
    match = _SPOTIFY_URI_RE.match(text)
    if match:
        return f"spotify-{match.group(1).lower()}", match.group(2)
    match = _SPOTIFY_URL_RE.match(text)
    if match:
        return f"spotify-{match.group(1).lower()}", match.group(2)
    if _BARE_SPOTIFY_ID_RE.match(text):
        return "spotify-playlist", text
    raise ResolveError(400, _BAD_URL_MESSAGE)


# ── embed parsing (server/spotify_scrape.py) ────────────────────────────


def _track_id(uri: str) -> str:
    """``spotify:track:<id>`` -> ``<id>`` (falls back to the raw value)."""
    return uri.rsplit(":", 1)[-1] if uri else ""


def _extract_entity(page: str) -> dict:
    """The ``__NEXT_DATA__`` entity dict of an embed page, or raise 502."""
    match = _NEXT_DATA_RE.search(page)
    if not match:
        raise ResolveError(502, _LAYOUT_ERROR)
    try:
        payload = json.loads(match.group(1))
        entity = payload["props"]["pageProps"]["state"]["data"]["entity"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ResolveError(502, _LAYOUT_ERROR) from exc
    if not isinstance(entity, dict):
        raise ResolveError(502, _LAYOUT_ERROR)
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


def _raw_track(raw, *, fallback_album="", fallback_artwork=None, fallback_id=""):
    """
    One embed-shaped raw track dict → the common track dict.

    Mirrors ``spotify_scrape._raw_track`` (→ ``SpotifyTrack``) followed by
    ``importing._spotify_track_dict`` (→ common shape). Returns ``None``
    for rows that are not playable tracks.
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
    duration_ms = int(raw.get("duration_ms") or raw.get("duration") or 0)
    return {
        "id": track_id,
        "title": title,
        "artists": artists,
        "artist": ", ".join(artists) if artists else "Unknown artist",
        "album": album_name or None,
        "artwork": artwork,
        "duration_ms": duration_ms or None,
        "url": (
            external_urls.get("spotify")
            if isinstance(external_urls, dict) and external_urls.get("spotify")
            else f"https://open.spotify.com/track/{track_id}"
        ),
        "explicit": bool(
            raw.get("explicit") if "explicit" in raw else raw.get("isExplicit")
        ),
        "isrc": external_ids.get("isrc") if isinstance(external_ids, dict) else None,
    }


def _entity_raw_tracks(entity: dict) -> list | None:
    """The entity's raw track list, whichever shape it ships in (or None)."""
    track_list = entity.get("trackList")
    if isinstance(track_list, list):
        return track_list
    tracks = entity.get("tracks")
    if isinstance(tracks, dict) and isinstance(tracks.get("items"), list):
        return tracks["items"]
    if isinstance(tracks, list):
        return tracks
    return None


def parse_embed_entity(page: str, kind: str, entity_id: str) -> dict:
    """Build the ``/convert/resolve`` payload from any Spotify embed page."""
    entity = _extract_entity(page)
    artwork = _entity_artwork(entity)
    name = str(entity.get("title") or entity.get("name") or "").strip()
    subtitle = str(entity.get("subtitle") or "").strip()

    tracks: list[dict] = []
    if kind == "track":
        single = _raw_track(entity, fallback_artwork=artwork, fallback_id=entity_id)
        if single is None:
            raise ResolveError(502, _LAYOUT_ERROR)
        tracks = [single]
        if not name:
            name = single["title"]
    else:
        raw_tracks = _entity_raw_tracks(entity)
        if raw_tracks is None:
            raise ResolveError(502, _LAYOUT_ERROR)
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
        owner = tracks[0]["artist"]
    if kind == "artist" and not owner:
        # importing.resolve_spotify: an artist's owner falls back to its name.
        owner = name
    source = {
        "kind": f"spotify-{kind}",
        "id": entity_id,
        "name": name or f"Spotify {kind}",
        "owner": owner,
        "artwork": artwork,
        "url": f"https://open.spotify.com/{kind}/{entity_id}",
        "track_count": len(tracks),
    }
    return {"source": source, "tracks": tracks}


# ── resolve ─────────────────────────────────────────────────────────────


def _fetch_embed(kind: str, entity_id: str) -> str:
    url = EMBED_URL_TEMPLATE.format(kind=kind, entity_id=entity_id)
    request = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise ResolveError(
                404,
                f"Spotify couldn't find that {kind} — it may be private, "
                "deleted, or the link is wrong.",
            ) from exc
        raise ResolveError(
            502,
            f"Spotify answered with HTTP {exc.code} while reading the {kind} page.",
        ) from exc
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise ResolveError(502, f"Couldn't reach Spotify: {exc}") from exc


def resolve_spotify(url: str) -> dict:
    """Classify *url* and resolve it to the common ``/convert/resolve`` shape."""
    kind_full, entity_id = classify_spotify(url)
    kind = kind_full.removeprefix("spotify-")
    page = _fetch_embed(kind, entity_id)
    return parse_embed_entity(page, kind, entity_id)


# ── Vercel handler ──────────────────────────────────────────────────────


class handler(BaseHTTPRequestHandler):
    """Vercel Python function entry point (``GET /api/resolve?url=…``)."""

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — BaseHTTPRequestHandler API
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query or "")
        url = (params.get("url") or [""])[0]
        try:
            if not url.strip():
                raise ResolveError(400, "Missing the `url` query parameter.")
            payload = resolve_spotify(url)
        except ResolveError as exc:
            self._send_json(exc.status, {"detail": exc.message, "error": exc.message})
            return
        except Exception as exc:  # noqa: BLE001 — never leak an HTML 500
            self._send_json(502, {"detail": str(exc), "error": str(exc)})
            return
        self._send_json(200, payload)

    def do_OPTIONS(self) -> None:  # noqa: N802 — CORS preflight, if any
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002 — quiet
        pass
