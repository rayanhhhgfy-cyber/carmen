import asyncio
import functools
import logging
import os
from pathlib import Path

import aiohttp
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..core import download_audio, get_stream_url, get_stream_url_ttl
from .. import state

router = APIRouter(tags=["Stream"])
log = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024  # 64 KB
CHAT_ID = os.environ.get("CHAT_ID")


# ── Helpers ─────────────────────────────────────────────────────────────────


async def _get_cached_url(vid_id: str) -> str | None:
    """Return a cached stream URL from Redis, or None if missing/expired."""
    return await state.rds.get(f"stream_url:{vid_id}")


async def _cache_url(vid_id: str, url: str, ttl: int):
    """Cache a stream URL in Redis with the given TTL (seconds)."""
    await state.rds.set(f"stream_url:{vid_id}", url, ex=ttl)


async def _get_tg_msg_id(vid_id: str) -> int | None:
    """Return the Telegram message ID for a cached audio, or None."""
    raw = await state.rds.hget("vids", vid_id)
    return int(raw) if raw else None


async def _upload_to_tg(vid_id: str, stream_url: str):
    """
    Download the audio and upload it to the Telegram channel.
    Retries on FloodWait by sleeping for the required duration.
    """
    if not state.tg_client or not CHAT_ID:
        return

    tmp_path: str | None = None
    try:
        loop = asyncio.get_running_loop()
        tmp_path = await loop.run_in_executor(
            state.executor, functools.partial(download_audio, vid_id, stream_url)
        )

        # Retry loop for FloodWait
        while True:
            try:
                msg = await state.tg_client.send_document(
                    int(CHAT_ID),
                    tmp_path,
                    file_name=f"{vid_id}.webm",
                )
                await state.rds.hset("vids", vid_id, msg.id)
                log.info("Uploaded %s to Telegram (msg %s)", vid_id, msg.id)
                break
            except Exception as exc:
                # FloodWaitError has a `value` attribute (seconds to wait)
                flood_wait = getattr(exc, "value", None)
                if flood_wait is not None:
                    log.warning("FloodWait on %s — sleeping %ds", vid_id, flood_wait)
                    await asyncio.sleep(flood_wait + 1)
                    continue
                log.error("Failed to upload %s to Telegram: %s", vid_id, exc)
                break
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


# ── Stream endpoint ─────────────────────────────────────────────────────────


@router.get(
    "/stream",
    summary="Stream Audio",
    response_description="Proxied audio stream for the given video",
)
async def stream_audio(
    vidId: str = Query(..., description="YouTube video ID to stream"),
):
    """
    Resolves a direct streaming URL via yt-dlp and proxies the audio bytes
    back to the client.

    Priority:
    1. Telegram cache — stream directly from Telegram if available (fastest).
    2. Redis URL cache — reuse a previously resolved googlevideo URL.
    3. Fresh yt-dlp resolve — run yt-dlp, cache the URL by its expiry TTL.

    In all cases, a background task uploads the audio to Telegram for future
    requests (if not already cached).
    """
    # ── 1. Telegram cache ───────────────────────────────────────────────
    tg_msg_id = await _get_tg_msg_id(vidId)
    if tg_msg_id and state.tg_client and CHAT_ID:
        try:
            message = await state.tg_client.get_message(int(CHAT_ID), tg_msg_id)

            async def _tg_stream():
                async for chunk in state.tg_client.stream_media(message):
                    yield chunk

            return StreamingResponse(
                _tg_stream(),
                media_type="audio/webm",
                headers={"Cache-Control": "no-cache"},
            )
        except Exception as exc:
            log.warning("Telegram cache miss for %s: %s — falling through", vidId, exc)

    # ── 2. Cached URL ──────────────────────────────────────────────────
    url = await _get_cached_url(vidId)

    # ── 3. Fresh yt-dlp resolve ─────────────────────────────────────────
    if not url:
        loop = asyncio.get_running_loop()
        try:
            url = await loop.run_in_executor(
                state.executor, functools.partial(get_stream_url, vidId)
            )
        except FileNotFoundError:
            raise HTTPException(
                status_code=500,
                detail="yt-dlp is not installed or not found on PATH",
            )
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to resolve stream URL: {exc}",
            )

        if not url:
            raise HTTPException(
                status_code=502,
                detail="yt-dlp returned no stream URL",
            )

        ttl = get_stream_url_ttl(url)
        await _cache_url(vidId, url, ttl)

    # ── 4. Proxy the googlevideo stream ─────────────────────────────────
    async def _proxy():
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Upstream returned HTTP {resp.status}",
                    )
                async for chunk in resp.content.iter_chunked(CHUNK_SIZE):
                    yield chunk

    # ── 5. Background: upload to Telegram (fire-and-forget) ─────────────
    already_uploading = await state.rds.hget("vids", vidId) is not None
    if not already_uploading and state.tg_client and CHAT_ID:
        asyncio.create_task(_upload_to_tg(vidId, url))

    return StreamingResponse(
        _proxy(),
        media_type="audio/webm",
        headers={"Cache-Control": "no-cache"},
    )
