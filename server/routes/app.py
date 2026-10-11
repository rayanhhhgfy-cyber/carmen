"""
The SPA shell route that renders link previews.

Telegram/Discord crawlers never run the JS router, so a song or search link
(``https://host/?song=xyz``) has to come back from the server as HTML with the
right Open Graph tags already in ``<head>``. This router serves that shell:
it reads the share query-string, resolves the content, and injects the tags
into the built ``frontend/dist/index.html``.

The router is registered **last** so every real API route matches before this
catch-all, and the nginx vhost proxies the exact path ``/`` to it (see
``deploy/nginx.conf``); ``/assets`` and other real files stay static.
"""
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from ..share import render_index, resolve_preview

router = APIRouter(tags=["App"])


def _origin(request: Request) -> str:
    """Public origin of the app (scheme + host), no trailing slash."""
    return str(request.base_url).rstrip("/")


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
@router.get("/{spa_path:path}", response_class=HTMLResponse, include_in_schema=False)
async def spa_index(request: Request, spa_path: str = ""):
    """
    Serve the web client's index.html with per-link Open Graph tags.

    Recognises the share query-string: ``?song=<videoId>``,
    ``?search=<query>`` and ``?playlist=<playlistId>``. Anything else (or no
    query) gets Carmen's generic preview. Real API routes are registered on
    their own routers and take priority over this catch-all.
    """
    params = request.query_params
    preview = await resolve_preview(
        song=params.get("song"),
        search_query=params.get("search"),
        playlist=params.get("playlist"),
    )
    origin = _origin(request)
    # The shareable URL keeps the hash route so opening the link lands on the
    # same page the preview describes (the hash is client-side only).
    page_url = _page_url(origin, params)
    return HTMLResponse(render_index(preview, page_url, default_image=None))


def _page_url(origin: str, params) -> str:
    """Rebuild the in-app URL (with the #/ hash route) for og:url."""
    song = params.get("song")
    search = params.get("search")
    playlist = params.get("playlist")
    if song:
        return f"{origin}/#/song/{song}"
    if search:
        return f"{origin}/#/search?query={search}"
    if playlist:
        return f"{origin}/#/collection/playlist/{playlist}"
    return f"{origin}/"
