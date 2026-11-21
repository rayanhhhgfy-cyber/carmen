import asyncio
from concurrent.futures import ThreadPoolExecutor

from redis.asyncio.client import Redis

executor: ThreadPoolExecutor = ThreadPoolExecutor(8)
rds: Redis = None

# Telegram Bot API client (server/tg_bot.py, initialized in lifespan).
# Needs only BOT_TOKEN + CHAT_ID — no api_id / api_hash.
tg_client = None

# Simple upload queue: vidId -> asyncio.Event (set when upload completes)
_upload_tasks: dict[str, asyncio.Event] = {}


def get_upload_event(vid_id: str) -> asyncio.Event | None:
    """Return the Event for an in-progress upload, or None."""
    return _upload_tasks.get(vid_id)


def set_upload_event(vid_id: str, event: asyncio.Event):
    _upload_tasks[vid_id] = event


def pop_upload_event(vid_id: str) -> asyncio.Event | None:
    return _upload_tasks.pop(vid_id, None)
