import asyncio
import functools
import logging
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from yt_dlp.utils import DownloadError

from .. import state
from ..core import download_audio, find_cached_audio
from ..filters import DurationLimitExceeded

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


def _audio_response(path: Path | str, vid_id: str) -> FileResponse:
    """
    Serve a locally downloaded audio file.

    ``FileResponse`` answers HTTP range requests (206), which is what lets the
    browser seek inside the track.
    """
    path = Path(path)
    media_type = MEDIA_TYPES.get(path.suffix.lower(), "audio/mp4")
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
            "X-Accel-Buffering": "no",
        },
    )


# ── Stream endpoint ─────────────────────────────────────────────────────────


@router.get(
    "/stream",
    summary="Stream Audio",
    response_description="Audio file buffered on the server for the given video",
)
async def stream_audio(
    vidId: str = Query(..., description="YouTube video ID to stream"),
):
    """
    Downloads the audio with yt-dlp on the server and serves the buffered file.

    The raw googlevideo URL is never handed back to the client: the server
    resolves the track, checks the one hour duration limit, stores the bytes
    in its audio cache and answers with a local ``FileResponse`` (range
    requests included).  Repeat requests are served straight from disk.

    Priority:
    1. Local audio cache — the file is already downloaded.
    2. yt-dlp download — resolve + buffer on the server (shared per video).

    When Telegram caching is configured the downloaded file is additionally
    uploaded in the background to keep a remote copy.
    """
    cached = find_cached_audio(vidId)
    if cached:
        return _audio_response(cached, vidId)

    loop = asyncio.get_running_loop()
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

    return _audio_response(path, vidId)
