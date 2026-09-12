import asyncio
import json
import os
import redis.asyncio as redis
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
import uvloop
from dotenv import load_dotenv
from fastapi import FastAPI
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
    title="Samma3ni API",
    description="YouTube Music exploration API powered by ytmusicapi",
    version="1.0.0",
    debug=False,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)
app.include_router(router)


async def main():
    config = uvicorn.Config(app=app, host="0.0.0.0", port=PORT)
    server = uvicorn.Server(config)

    await server.serve()


if __name__ == "__main__":
    with asyncio.Runner(loop_factory=uvloop.new_event_loop) as runner:
        runner.run(main())
