"""
Link previews (Open Graph / Twitter cards) for the web client.

Telegram, Discord, WhatsApp … never see the `#/…` hash — a crawler fetching
``https://host/#/song/xyz`` actually requests ``https://host/`` and the JS
router runs client-side after the response is already parsed. So per-page
previews have to live in the **query string** before the hash
(``https://host/?song=xyz``) and be rendered into the HTML server-side.

This module reads that query string, resolves the underlying content through
the same cached core the API uses, and injects ``<meta property="og:…">`` (+
Twitter equivalents) into the built ``frontend/dist/index.html`` before it is
served. Anything it cannot resolve falls back to Carmen's generic tags.
"""
import asyncio
import html
import logging
import re
from functools import partial
from pathlib import Path

from .core import get_playlist, get_track
from .state import executor

log = logging.getLogger(__name__)

DIST = Path("frontend/dist")
INDEX = DIST / "index.html"

# Generic brand preview — used for the home page and any unresolvable link.
# `default_image` is injected by the caller (the SPA index route) so this
# module stays free of a hardcoded brand asset; the repo ships no og image.
DEFAULT_TITLE = "Carmen"
DEFAULT_DESCRIPTION = "Stream, play and download your music."

_TITLE_RE = re.compile(r"<title>.*?</title>", re.IGNORECASE | re.DOTALL)
_DESC_RE = re.compile(r'<meta\s+name="description"\s+content="[^"]*"\s*/?>', re.IGNORECASE)


def _esc(value: object) -> str:
    """XML-escape an attribute value for the injected <meta> tags."""
    return html.escape(str(value if value is not None else ""), quote=True)


def _largest(thumbnails) -> str | None:
    if not isinstance(thumbnails, list):
        return None
    best, best_area = None, -1
    for thumb in thumbnails:
        if not isinstance(thumb, dict) or not thumb.get("url"):
            continue
        area = (thumb.get("width") or 0) * (thumb.get("height") or 0)
        if area > best_area:
            best_area, best = area, thumb["url"]
    return best


def _track_preview(video_id: str) -> dict | None:
    """Title / artist / artwork for one song."""
    try:
        meta = get_track(video_id, None)
    except Exception as exc:  # noqa: BLE001 — a dead video must not 500 the page
        log.info("share: track %s unresolved — %s", video_id, exc)
        return None
    if not meta:
        return None

    artists = meta.get("artists") or []
    artist = ", ".join(
        a.get("name") if isinstance(a, dict) else str(a)
        for a in artists
        if (a.get("name") if isinstance(a, dict) else a)
    )
    title = meta.get("title") or DEFAULT_TITLE
    description = f"{title} — {artist}" if artist else title
    duration = meta.get("duration_seconds")
    if duration:
        minutes, seconds = divmod(int(duration), 60)
        description += f"  ·  {minutes}:{seconds:02d}"

    return {
        "title": title,
        "description": description,
        "image": _largest(meta.get("artwork") or meta.get("thumbnails"))
        or f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        "type": "music.song",
    }


def _search_preview(query: str) -> dict:
    return {
        "title": f"{query} — {DEFAULT_TITLE}",
        "description": f"Search results for “{query}” on {DEFAULT_TITLE}.",
        "image": None,
        "type": "website",
    }


def _playlist_preview(playlist_id: str) -> dict | None:
    try:
        data = get_playlist(playlist_id, 1, False, 0)
    except Exception as exc:  # noqa: BLE001
        log.info("share: playlist %s unresolved — %s", playlist_id, exc)
        return None
    if not data:
        return None
    title = data.get("title") or DEFAULT_TITLE
    author = data.get("author")
    description = f"{title} — {author}" if author else title
    return {
        "title": title,
        "description": description,
        "image": _largest(data.get("thumbnails")),
        "type": "music.playlist",
    }


async def resolve_preview(song, search_query, playlist) -> dict | None:
    """
    Resolve the share query-string into a preview dict, off the event loop.

    Returns the generic Carmen preview when nothing is shared or nothing can
    be resolved, so the page always renders a sane card.
    """
    loop = asyncio.get_running_loop()
    preview = None
    if song:
        preview = await loop.run_in_executor(executor, partial(_track_preview, song))
    elif playlist:
        preview = await loop.run_in_executor(executor, partial(_playlist_preview, playlist))
    elif search_query:
        preview = _search_preview(search_query)

    if preview is None:
        return {
            "title": DEFAULT_TITLE,
            "description": DEFAULT_DESCRIPTION,
            "image": None,
            "type": "website",
        }
    return preview


def _render_tags(preview: dict, page_url: str, default_image: str | None) -> str:
    """The <meta> block injected into <head>, og: + twitter: together."""
    title = preview.get("title") or DEFAULT_TITLE
    description = preview.get("description") or DEFAULT_DESCRIPTION
    image = preview.get("image") or default_image
    kind = preview.get("type") or "website"

    tags = [
        ('meta', {"property": "og:site_name", "content": DEFAULT_TITLE}),
        ('meta', {"property": "og:type", "content": kind}),
        ('meta', {"property": "og:title", "content": title}),
        ('meta', {"property": "og:description", "content": description}),
        ('meta', {"property": "og:url", "content": page_url}),
    ]
    if image:
        tags.append(('meta', {"property": "og:image", "content": image}))
    tags += [
        ('meta', {"name": "twitter:card", "content": "summary_large_image" if image else "summary"}),
        ('meta', {"name": "twitter:title", "content": title}),
        ('meta', {"name": "twitter:description", "content": description}),
    ]
    if image:
        tags.append(('meta', {"name": "twitter:image", "content": image}))

    lines = [f'<{_esc(t[0])} ' + " ".join(f'{_esc(k)}="{_esc(v)}"' for k, v in t[1].items()) + " />" for t in tags]
    return "\n    ".join(lines)


def render_index(preview: dict, page_url: str, default_image: str | None) -> str:
    """Inject the preview tags + <title> into the built index.html."""
    try:
        source = INDEX.read_text()
    except OSError:
        # No build present (e.g. API-only deployment): serve a minimal shell
        # that still carries the preview tags so a crawler sees the card.
        tags = _render_tags(preview, page_url, default_image)
        title = preview.get("title") or DEFAULT_TITLE
        return (
            "<!doctype html><html><head><meta charset=\"UTF-8\" />"
            f"<title>{_esc(title)}</title>\n    {tags}</head>"
            "<body><div id=\"root\"></div></body></html>"
        )

    title = preview.get("title") or DEFAULT_TITLE
    description = preview.get("description") or DEFAULT_DESCRIPTION
    tags = _render_tags(preview, page_url, default_image)

    html_text = _TITLE_RE.sub(f"<title>{_esc(title)}</title>", source, count=1)
    if _DESC_RE.search(html_text):
        html_text = _DESC_RE.sub(
            f'<meta name="description" content="{_esc(description)}" />', html_text, count=1
        )
    # Inject the og/twitter block right before </head> (after the description
    # swap so the injected tags are never re-matched by the regex above).
    return html_text.replace("</head>", f"    {tags}\n  </head>", 1)
