import asyncio
import functools
import logging
import os
import re
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from yt_dlp.utils import DownloadError

from .. import state
from ..core import (
    AUDIO_CACHE_DIR,
    STREAM_CLIENTS,
    StreamTarget,
    _is_permanent_failure,
    _prune_audio_cache,
    download_audio,
    find_cached_audio,
    forget_stream_url,
    resolve_stream_url,
)
from ..filters import DurationLimitExceeded
from ..sanitizers import sanitized

router = APIRouter(tags=["Stream"])
log = logging.getLogger(__name__)

CHAT_ID = os.environ.get("CHAT_ID")

# Any URL (googlevideo/videoplayback/...) must never reach the client.
_URL_PATTERN = re.compile(r"https?://\S+|videoplayback\?\S+", re.IGNORECASE)

MEDIA_TYPES = {
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
}

# Headers copied from the CDN response straight through to the browser.
# `Content-Length` / `Content-Range` are what make seeking (and the buffered
# part of the seek bar) work, so they are always forwarded when present.
# `Content-Type` is deliberately **not** forwarded: `_media_type` decides it,
# so an unhelpful `application/octet-stream` from the CDN can never reach the
# `<audio>` element.
_PASSTHROUGH = (
    "content-length",
    "content-range",
    "accept-ranges",
    "content-encoding",
    "content-md5",
    "etag",
    "last-modified",
    "cache-control",
)

# Upstream answers another player client may still fix (403 = CDN rejected the
# signed URL for this IP, 404 = this client's format is gone, ...).
_REJECTED_STATUS = {400, 401, 403, 404, 410, 429}

_CHUNK = 64 * 1024

_RANGE_RE = re.compile(r"bytes\s+(\d+)-(\d+|\*)/(\d+|\*)")


class _UpstreamRejected(Exception):
    """The CDN refused this stream URL — another player client may work."""


# ── Helpers ─────────────────────────────────────────────────────────────────


async def _get_tg_msg_id(vid_id: str) -> int | None:
    """Return the Telegram message ID for a cached audio, or None."""
    raw = await state.rds.hget("vids", vid_id)
    return int(raw) if raw else None


async def _upload_to_tg(vid_id: str, path: str):
    """
    Upload an already downloaded audio file to the Telegram channel.

    Retries on FloodWait by sleeping for the required duration.  The file is
    kept on disk — Telegram acts as a remote backup of the audio cache.
    """
    if not state.tg_client or not CHAT_ID:
        return

    while True:
        try:
            msg = await state.tg_client.send_document(
                int(CHAT_ID),
                path,
                file_name=Path(path).name,
            )
            await state.rds.hset("vids", vid_id, msg.id)
            log.info("Uploaded %s to Telegram (msg %s)", vid_id, msg.id)
            break
        except Exception as exc:  # noqa: BLE001
            # FloodWaitError has a `value` attribute (seconds to wait)
            flood_wait = getattr(exc, "value", None)
            if flood_wait is not None:
                log.warning("FloodWait on %s — sleeping %ds", vid_id, flood_wait)
                await asyncio.sleep(flood_wait + 1)
                continue
            log.error("Failed to upload %s to Telegram: %s", vid_id, exc)
            break


def _safe_detail(exc: Exception) -> str:
    """
    Turn a yt-dlp failure into a client facing message.

    The full error is logged server side, but streaming URLs (googlevideo,
    videoplayback, ...) are stripped from anything sent back to the browser.
    """
    text = " ".join(str(exc).split())
    text = _URL_PATTERN.sub("[streaming url removed]", text).strip()
    return text[:300] or "unknown error"


def _media_type(headers: httpx.Headers, url: str) -> str:
    """Audio content type for a proxied response (from header, else suffix)."""
    declared = (headers.get("content-type") or "").split(";")[0].strip()
    if declared.startswith(("audio/", "video/")):
        return declared
    suffix = Path(url.split("?", 1)[0]).suffix.lower()
    return MEDIA_TYPES.get(suffix, "audio/mp4")


def _open_tee(tmp_path: Path):
    """Open the temporary cache file of a relay, or ``(None, False)``."""
    try:
        return open(tmp_path, "wb"), True
    except OSError:
        return None, False


def _is_whole_body(status_code: int, range_header: str | None, headers) -> bool:
    """
    True when the upstream response is (or will be) the complete audio file.

    Only then is it worth teeing into the on-disk cache: a partial answer
    (a seek that landed in the middle of the track) must never be stored as
    if it were the whole song.
    """
    if (headers.get("content-length") or "").strip() == "0":
        return False
    if status_code == 200:
        # the origin ignored the Range header and sent everything
        return True
    if status_code != 206 or not range_header:
        return False
    match = _RANGE_RE.match(headers.get("content-range") or "")
    if not match:
        return False
    start, end, total = match.groups()
    if start != "0":
        return False
    return total == "*" or (end != "*" and int(end) + 1 == int(total))


async def _proxy_audio(
    request: Request, target: StreamTarget, vid_id: str
) -> StreamingResponse:
    """
    Relay the CDN response to the browser, range requests included.

    The first byte arrives as soon as the CDN has it instead of after the
    whole track has been written to disk, which is what made playback feel
    slow.  The remote URL itself still never leaves the server.

    While a *complete* body passes through it is also written into the audio
    cache, so the next play of that track is served from disk.
    """
    upstream_headers = dict(target.headers or {})
    upstream_headers.pop("Host", None)
    upstream_headers.pop("host", None)
    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header

    client = httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(20.0, read=120.0),
    )
    upstream = await client.send(
        client.build_request("GET", target.url, headers=upstream_headers),
        stream=True,
    )

    if upstream.status_code in _REJECTED_STATUS:
        status = upstream.status_code
        await upstream.aclose()
        await client.aclose()
        raise _UpstreamRejected(f"upstream responded with {status}")

    headers = {
        key: value
        for key, value in upstream.headers.items()
        if key in _PASSTHROUGH
    }
    headers.setdefault("accept-ranges", "bytes")
    headers["X-Accel-Buffering"] = "no"

    tee_path: Path | None = None
    tmp_path: Path | None = None
    if _is_whole_body(upstream.status_code, range_header, upstream.headers):
        AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp_path = AUDIO_CACHE_DIR / f"{vid_id}.{uuid.uuid4().hex}.part"
        tee_path = AUDIO_CACHE_DIR / f"{vid_id}.m4a"

    written = 0

    async def pump():
        nonlocal written
        # opened lazily: if the response is never iterated nothing is left
        # behind on disk, and it is closed by the `finally` below either way
        handle = _open_tee(tmp_path)[0] if tmp_path else None
        tee_ok = handle is not None
        try:
            async for chunk in upstream.aiter_raw(_CHUNK):
                if handle is not None and tee_ok:
                    try:
                        handle.write(chunk)
                    except OSError:
                        # disk trouble must never break playback
                        tee_ok = False
                written += len(chunk)
                yield chunk
        finally:
            if handle is not None:
                try:
                    handle.flush()
                    handle.close()
                except (OSError, ValueError):
                    tee_ok = False
                expected = int(upstream.headers.get("content-length") or 0)
                if tee_ok and expected and written == expected and tmp_path and tee_path:
                    os.replace(tmp_path, tee_path)
                    _prune_audio_cache()
                    log.info(
                        "Cached streamed audio for %s (%d bytes)", vid_id, written
                    )
                elif tmp_path:
                    tmp_path.unlink(missing_ok=True)
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        pump(),
        status_code=upstream.status_code,
        headers=headers,
        media_type=_media_type(upstream.headers, target.url),
    )


# ── Stream endpoint ─────────────────────────────────────────────────────────


@router.get(
    "/stream/status",
    summary="Audio Cache Status",
    response_description="Whether the audio of the video is already on disk",
)
@sanitized
async def stream_status(
    vidId: str = Query(..., description="YouTube video ID to check"),
):
    """
    Whether the audio of a video is already in the server side audio cache.

    The client polls this while the song is still streaming: as soon as the
    relay has finished writing the file, a download can read it straight from
    disk instead of opening a second live stream next to the one the player
    is holding open.

    Deliberately not cached — the whole point of the answer is how fresh it
    is — and it only stats a file, so it never touches yt-dlp or the CDN.
    """
    return {"cached": bool(find_cached_audio(vidId))}


@router.get(
    "/stream",
    summary="Stream Audio",
    response_description="Audio file buffered on the server for the given video",
)
async def stream_audio(
    request: Request,
    vidId: str = Query(..., description="YouTube video ID to stream"),
):
    """
    Serve the audio of a video, always through this server.

    Priority:

    1. **local audio cache** — the track was already downloaded, served with a
       ``FileResponse`` (HTTP range requests included);
    2. **relayed stream** — yt-dlp resolves the CDN URL (cached in memory with
       its expiry) and the bytes are forwarded chunk by chunk, so playback
       starts immediately and seeking works while the rest is still coming;
       complete relays are written into the audio cache on the way out;
    3. **full yt-dlp download** — used when the CDN rejects every relayed
       attempt, the file is then buffered on disk first.

    The raw googlevideo URL is never handed back to the client.

    When Telegram caching is configured the downloaded file is additionally
    uploaded in the background to keep a remote copy.
    """
    cached = find_cached_audio(vidId)
    if cached:
        try:
            return _audio_response(cached, vidId)
        except OSError:
            # The audio cache only keeps its newest files, so this one may
            # have been pruned between the lookup and the open.  Falling
            # through relays it again instead of letting a broken response
            # reach the browser as a headerless 500 — which it reports as a
            # CORS error.
            log.warning("Cached audio for %s disappeared before serving", vidId)

    loop = asyncio.get_running_loop()
    skip: set = set()

    # 2) relay through the server
    while len(skip) <= len(STREAM_CLIENTS):
        try:
            target = await loop.run_in_executor(
                state.executor, functools.partial(resolve_stream_url, vidId, skip)
            )
        except DurationLimitExceeded as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            log.warning("Stream resolution failed for %s: %s", vidId, exc)
            if _is_permanent_failure(exc):
                # Every player client already reported the track itself as
                # unavailable — the full download path would only repeat the
                # very same yt-dlp attempts, so fail right away.
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to download audio: {_safe_detail(exc)}",
                ) from exc
            break

        try:
            return await _proxy_audio(request, target, vidId)
        except _UpstreamRejected as exc:
            log.warning(
                "CDN rejected the %s stream for %s: %s",
                target.client,
                vidId,
                exc,
            )
            forget_stream_url(vidId)
            skip.add(target.client)
        except Exception as exc:  # noqa: BLE001
            # The connection to the CDN died before a single byte was sent
            # (network blip, URL expired while connecting, socket reset).
            # Nothing is on the wire yet, so move to the next player client
            # and let the full download below be the last resort — letting
            # this escape used to reach the browser as a headerless 500,
            # which it reported as a CORS error.
            log.warning(
                "Relay failed for %s via %s: %s",
                vidId,
                target.client,
                exc,
            )
            skip.add(target.client)

    # 3) fall back to buffering the whole file on the server
    try:
        path = await loop.run_in_executor(
            state.executor, functools.partial(download_audio, vidId)
        )
    except DurationLimitExceeded as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="yt-dlp is not installed or not found on PATH",
        ) from exc
    except DownloadError as exc:
        log.warning("yt-dlp failed for %s: %s", vidId, exc)
        raise HTTPException(
            status_code=502,
            detail=f"Failed to download audio: {_safe_detail(exc)}",
        ) from exc
    except Exception as exc:
        log.warning("Audio download failed for %s: %s", vidId, exc)
        raise HTTPException(
            status_code=502,
            detail=f"Failed to download audio: {_safe_detail(exc)}",
        ) from exc

    # Background: keep a Telegram copy of the freshly downloaded audio
    if state.tg_client and CHAT_ID and not await _get_tg_msg_id(vidId):
        asyncio.create_task(_upload_to_tg(vidId, path))

    try:
        return _audio_response(path, vidId)
    except OSError as exc:
        raise HTTPException(
            status_code=502,
            detail="The downloaded audio could not be read from disk",
        ) from exc


def _audio_response(path: Path | str, vid_id: str) -> FileResponse:
    """
    Serve a locally downloaded audio file.

    ``FileResponse`` answers HTTP range requests (206), which is what lets the
    browser seek inside the track.
    """
    path = Path(path)
    media_type = MEDIA_TYPES.get(path.suffix.lower(), "audio/mp4")
    # Stat up front and hand the result over: on its own ``FileResponse``
    # stats *after* the route returned, and a file that vanished in between
    # (pruned, rewritten by a download) used to raise a ``RuntimeError``
    # before the response headers — a headerless 500 that the browser
    # reports as a CORS error.  Raising here lets the caller fall back to
    # the relay instead.
    return FileResponse(
        path,
        stat_result=path.stat(),
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
            "X-Accel-Buffering": "no",
        },
    )
