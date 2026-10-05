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
from pyrogram import Client

from . import state
from .core import init_ytm
from .routes import router

load_dotenv()

PORT = int(os.environ.get("PORT", "8000"))
BROWSER_PATH = Path(os.environ.get("BROWSER_PATH", "browser.json"))
CHAT_ID = os.environ.get("CHAT_ID")
TG_NAME = os.environ.get("TG_NAME", "ytmusic_cache")
TG_API_ID = os.environ.get("API_ID")
TG_API_HASH = os.environ.get("API_HASH")
TG_BOT_TOKEN = os.environ.get("BOT_TOKEN")

for key in ["NODE_CHANNEL_FD", "NODE_OPTIONS"]:
    os.environ.pop(key, None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_ytm(BROWSER_PATH)
    print("YouTube Music's Client Initialized.")

    state.rds = redis.Redis()
    print("Redis client ready.")

    # Telegram client for audio caching
    if TG_API_ID and TG_API_HASH and TG_BOT_TOKEN:
        state.tg_client = Client(
            TG_NAME,
            api_id=int(TG_API_ID),
            api_hash=TG_API_HASH,
            bot_token=TG_BOT_TOKEN,
        )
        await state.tg_client.start()
        print("Telegram client initialized.")
    else:
        print("Telegram credentials not set — skipping TG cache.")

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

    yield

    if state.tg_client:
        await state.tg_client.stop()
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

# The React client is served from another origin (or the dev server), and it
# reads audio bytes for the browser side MP3 download, so CORS must be open
# and the range related headers must be readable from JS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Accept-Ranges",
        "Content-Length",
        "Content-Range",
        "ETag",
        "Last-Modified",
    ],
)

app.include_router(router)


async def main():
    config = uvicorn.Config(app=app, host="0.0.0.0", port=PORT)
    server = uvicorn.Server(config)

    await server.serve()


if __name__ == "__main__":
    with asyncio.Runner(loop_factory=uvloop.new_event_loop) as runner:
        runner.run(main())
