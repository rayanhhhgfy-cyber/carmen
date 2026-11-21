import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

import redis.asyncio as redis
import uvicorn
import uvloop
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from . import debuglog, state
from .tg_bot import TgBotClient
from .core import (
    AUDIO_CACHE_DIR,
    AUDIO_CACHE_MAX_BYTES,
    AUDIO_CACHE_PRUNE_INTERVAL,
    _prune_audio_cache,
    audio_cache_bytes,
    init_ytm,
)
from .errors import EXPOSE_HEADERS, CatchAllErrors
from .routes import router

load_dotenv()

PORT = int(os.environ.get("PORT", "8000"))
BROWSER_PATH = Path(os.environ.get("BROWSER_PATH", "browser.json"))
CHAT_ID = os.environ.get("CHAT_ID")
TG_BOT_TOKEN = os.environ.get("BOT_TOKEN")

# DEBUG_LOGS=1 → colored root logger that shows every line the app logs
# (uvicorn's default dictConfig leaves root at WARNING and drops them) —
# no-op when the flag is unset, so normal output stays exactly as before.
debuglog.configure()

for key in ["NODE_CHANNEL_FD", "NODE_OPTIONS"]:
    os.environ.pop(key, None)


async def _audio_cache_janitor():
    """Periodic size-cap enforcement for the on-disk audio cache.

    Each finished download already prunes, but the Telegram-cache path and
    tracks evicted mid-play would otherwise pile up unbounded between
    requests — this loop re-checks the 5 GiB budget while the server runs.
    """
    while True:
        await asyncio.sleep(AUDIO_CACHE_PRUNE_INTERVAL)
        try:
            await asyncio.to_thread(_prune_audio_cache)
        except Exception as exc:  # noqa: BLE001
            print(f"audio cache janitor failed: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # No browser.json (e.g. a fresh free-tier deploy): run unauthenticated.
    # Public search/browse/stream still work; only library features need auth.
    browser_path = BROWSER_PATH if BROWSER_PATH.is_file() else None
    init_ytm(browser_path)
    print("YouTube Music's Client Initialized.")

    # REDIS_URL (Render: a free external Redis, e.g. Redis Cloud) or the
    # upstream default localhost:6379 (a VPS running its own Redis).
    state.rds = redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379"))
    print("Redis client ready.")

    # Telegram Bot API client for audio caching — needs only the bot token
    # (no api_id / api_hash: the Bot API replaces the old MTProto client).
    if TG_BOT_TOKEN and CHAT_ID:
        state.tg_client = TgBotClient(TG_BOT_TOKEN)
        print("Telegram Bot API client initialized.")
    else:
        print("Telegram credentials not set — skipping TG cache.")

    if BROWSER_PATH.is_file():
        with open(BROWSER_PATH) as f:  # noqa: ASYNC230
            data = json.load(f)

        cookie_str = data.get("cookie", "") or data.get("Cookie", "")
        if not cookie_str:
            print("No cookie field found in browser.json")

        with open("server/cookies.txt", "w+") as out:  # noqa: ASYNC230
            out.write("# Netscape HTTP Cookie File\n# Generated from browser.json\n\n")
            for cookie in cookie_str.split("; "):
                if "=" in cookie:
                    name, value = cookie.split("=", 1)
                    secure = "TRUE" if name.startswith("__Secure-") else "FALSE"
                    out.write(f".youtube.com\tTRUE\t/\t{secure}\t0\t{name}\t{value}\n")
        print("Successfully created server/cookies.txt!")
    else:
        print("No browser.json — running unauthenticated, writing an empty cookies.txt.")
        with open("server/cookies.txt", "w+") as out:  # noqa: ASYNC230
            out.write("# Netscape HTTP Cookie File\n# No cookies configured\n\n")

    if debuglog.enabled():
        try:
            await state.rds.ping()
        except Exception:  # noqa: BLE001
            redis_note = "unreachable — the cache falls back to uncached"
        else:
            redis_note = "ok · localhost:6379"
        tg_note = (
            f"ok · chat {CHAT_ID}"
            if state.tg_client and CHAT_ID
            else "client up · CHAT_ID unset — caching disabled"
            if state.tg_client
            else "not configured — songs stream without the TG cache"
        )
        debuglog.banner(
            "carmen api · DEBUG_LOGS",
            [
                ("port", str(PORT)),
                (
                    "browser.json",
                    f"ok · {BROWSER_PATH}"
                    if BROWSER_PATH.is_file()
                    else f"MISSING · {BROWSER_PATH}",
                ),
                ("redis", redis_note),
                ("telegram", tg_note),
                (
                    "audio cache",
                    (
                        f"{AUDIO_CACHE_DIR} · ≤{AUDIO_CACHE_MAX_BYTES / 1024**3:g} GiB"
                        f" · {audio_cache_bytes() / 1024**3:.2f} GiB used"
                    ),
                ),
                ("logging", "DEBUG · colored · one line per request"),
            ],
        )

    # Enforce the 5 GiB audio-cache budget while the server runs (each
    # download prunes too — this catches the rest).
    janitor = asyncio.create_task(_audio_cache_janitor())

    yield

    janitor.cancel()
    try:
        await janitor
    except asyncio.CancelledError:
        pass
    if state.tg_client:
        await state.tg_client.close()
        print("Telegram client stopped.")
    print("Shutting down the executor")
    state.executor.shutdown(wait=True)


app = FastAPI(
    title="Carmen API",
    description="YouTube Music exploration API powered by ytmusicapi",
    version="1.0.0",
    debug=False,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Registered first on purpose: Starlette inserts each middleware at the front
# of the list and wraps the stack in reverse, so the *last* `add_middleware`
# call ends up on the outside.  Keeping CatchAllErrors below means every error
# it answers still travels through CORSMiddleware and keeps its headers —
# otherwise the browser reports the failure as a CORS problem instead of
# showing the real message.  It also stamps those headers onto the responses
# CORSMiddleware leaves alone (requests with no `Origin`, such as the player's
# own `<audio>` element), so a response the browser caches is always safe to
# reuse.  See server/errors.py.
app.add_middleware(CatchAllErrors)

# The React client is served from another origin (or the dev server), and it
# reads audio bytes for the browser side MP3 download, so CORS must be open
# and the range related headers must be readable from JS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=EXPOSE_HEADERS,
)

# Debug: with DEBUG_LOGS=1 the per-request timer joins the stack last, so it
# sits outside everything above (including CORS) and measures every completed
# body — streaming responses included.  Never added otherwise.
if debuglog.enabled():
    app.add_middleware(debuglog.RequestTimer)

app.include_router(router)


async def main():
    # With DEBUG_LOGS on, skip uvicorn's dictConfig so the root handler
    # configured by debuglog.configure() keeps formatting every line
    # (its own access line would duplicate RequestTimer).
    options = {"log_config": None} if debuglog.enabled() else {}
    config = uvicorn.Config(app=app, host="0.0.0.0", port=PORT, **options)
    server = uvicorn.Server(config)

    await server.serve()


if __name__ == "__main__":
    with asyncio.Runner(loop_factory=uvloop.new_event_loop) as runner:
        runner.run(main())
