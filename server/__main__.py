import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
import uvloop
from dotenv import load_dotenv
from fastapi import FastAPI

from .core import init_ytm
from .routes import router
from . import state

load_dotenv()

PORT = int(os.environ.get("PORT", "8000"))
BROWSER_PATH = Path(os.environ.get("BROWSER_PATH", "browser.json"))

@asynccontextmanager
async def lifespan(app: FastAPI):
  state.executor = ThreadPoolExecutor(8)
  print("Executor initialized.")

  init_ytm(BROWSER_PATH)
  print("YouTube Music's Client Initialized.")

  yield
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
