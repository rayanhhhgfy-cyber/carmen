"""Telegram Bot API client for the Carmen song cache.

The upstream server used kurigram (MTProto), which needs an ``api_id`` /
``api_hash`` pair created at my.telegram.org.  That creation is rate-limited
("Too many attempts"), so this module replaces the MTProto tier with the
plain Telegram **Bot API** (HTTPS), which needs only the bot token — no
api_id / api_hash at all.

What the Bot API can and cannot do for the cache:

* ``sendDocument`` uploads a song to the channel (bot is admin) and returns
  the message id **and** the document ``file_id``.  The file_id is what a
  later download needs; the message id is only kept so a stale copy can be
  deleted with ``deleteMessage``.
* ``getFile`` turns a file_id into a download path (and the byte count, so a
  cached copy can be verified against the size recorded at upload).
* The file itself is fetched over plain HTTPS from
  ``api.telegram.org/file/bot<token>/<file_path>``.  Bot API downloads are
  capped at 20 MB per file — a 128 kbps song is ~1 MB per minute, so every
  normal track fits; a very long track would simply fall through to the
  relay / full-download tiers instead.
* There is no "get message by id" in the Bot API, so the Redis ``vids``
  hash now stores the **file_id** (not a message id).  The message id lives
  in a separate ``vid_msgs`` hash, used only for deletion.  The cache is
  empty today (the MTProto tier never ran), so there is nothing to migrate.
"""

import asyncio
import logging
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

_API_BASE = "https://api.telegram.org/bot{token}"
_FILE_BASE = "https://api.telegram.org/file/bot{token}/{path}"

# Bot API download cap (20 MB).  A file bigger than this cannot be fetched
# with getFile, so the caller treats it as "not cached".
_MAX_BOT_DOWNLOAD = 20 * 1024 * 1024


class TgBotError(Exception):
    """A Bot API call failed (non-ok response or transport error)."""

    def __init__(self, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class TgBotClient:
    """Minimal async client for the Telegram Bot API (song cache only)."""

    def __init__(self, bot_token: str, timeout: float = 120.0):
        self._token = bot_token
        self._base = _API_BASE.format(token=bot_token)
        self._file_base = _FILE_BASE.format(token=bot_token, path="{path}")
        self._client = httpx.AsyncClient(
            base_url=self._base, timeout=timeout, follow_redirects=True
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _post(self, method: str, **kwargs) -> dict:
        """POST a Bot API method, returning the ``result`` dict."""
        try:
            resp = await self._client.post(f"/{method}", **kwargs)
        except httpx.HTTPError as exc:
            raise TgBotError(f"Bot API {method} transport error: {exc}") from exc
        try:
            payload = resp.json()
        except ValueError as exc:
            raise TgBotError(
                f"Bot API {method} returned non-JSON ({resp.status_code})"
            ) from exc
        if not payload.get("ok"):
            retry_after = None
            params = payload.get("parameters") or {}
            if isinstance(params, dict) and params.get("retry_after") is not None:
                try:
                    retry_after = int(params["retry_after"])
                except (TypeError, ValueError):
                    retry_after = None
            raise TgBotError(
                f"Bot API {method} failed ({resp.status_code}): "
                f"{payload.get('description', payload)}",
                retry_after=retry_after,
            )
        return payload["result"]

    async def send_document(
        self, chat_id: int | str, file_path: str | Path, file_name: str
    ) -> dict:
        """Upload a file to the channel as a document.

        Returns the message dict; the caller reads ``message_id`` and
        ``document.file_id`` / ``document.file_size`` from it.
        Retries once after a FloodWait (429 retry_after).
        """
        path = Path(file_path)
        for attempt in range(2):
            try:
                with path.open("rb") as fh:
                    files = {"document": (file_name, fh, "audio/mp4")}
                    data = {"chat_id": str(chat_id)}
                    return await self._post("sendDocument", data=data, files=files)
            except TgBotError as exc:
                if exc.retry_after is not None and attempt == 0:
                    log.warning(
                        "Bot API FloodWait on sendDocument — sleeping %ss",
                        exc.retry_after,
                    )
                    await asyncio.sleep(exc.retry_after + 1)
                    continue
                raise
        raise TgBotError("sendDocument failed after retry")

    async def get_file(self, file_id: str) -> dict:
        """Resolve a file_id to ``{file_path, file_size}``."""
        return await self._post("getFile", data={"file_id": file_id})

    async def download_file(self, file_path: str, dest: str | Path) -> int:
        """Download a Bot API file to disk.  Returns the bytes written."""
        url = self._file_base.format(path=file_path)
        dest = Path(dest)
        written = 0
        try:
            async with self._client.stream("GET", url) as resp:
                if resp.status_code != 200:
                    raise TgBotError(
                        f"Bot API file download failed ({resp.status_code})"
                    )
                dest.parent.mkdir(parents=True, exist_ok=True)
                with dest.open("wb") as fh:
                    async for chunk in resp.aiter_bytes(256 * 1024):
                        fh.write(chunk)
                        written += len(chunk)
        except httpx.HTTPError as exc:
            raise TgBotError(f"Bot API file download error: {exc}") from exc
        return written

    async def delete_message(self, chat_id: int | str, message_id: int) -> bool:
        """Delete a channel message.  Returns True when Telegram confirms."""
        try:
            await self._post(
                "deleteMessage",
                data={"chat_id": str(chat_id), "message_id": int(message_id)},
            )
            return True
        except TgBotError as exc:
            log.debug("Bot API deleteMessage failed: %s", exc)
            return False
