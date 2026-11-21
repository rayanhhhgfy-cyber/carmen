"""Admin endpoints for the Carmen API (cache seeding).

POST /admin/seed — record a Telegram-cached song so /stream can serve it.

The sandbox cannot open a raw TCP connection to Redis Cloud (the runtime
blocks direct TCP), so the fill script calls this endpoint over HTTPS and
the server — which already holds a Redis connection — writes the mapping.
Guarded by a shared secret: the X-Seed-Token header must equal SEED_TOKEN.
"""

import os

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from .. import state

router = APIRouter(tags=["Admin"])

SEED_TOKEN = os.environ.get("SEED_TOKEN")


class SeedRequest(BaseModel):
    video_id: str
    file_id: str
    message_id: int | None = None
    size: int = 0


@router.post("/admin/seed", summary="Record a Telegram-cached song")
async def seed_cache(
    body: SeedRequest, x_seed_token: str | None = Header(default=None)
):
    if not SEED_TOKEN or x_seed_token != SEED_TOKEN:
        raise HTTPException(status_code=401, detail="invalid seed token")
    if not body.video_id or not body.file_id:
        raise HTTPException(
            status_code=422, detail="video_id and file_id are required"
        )
    if state.rds is None:
        raise HTTPException(status_code=503, detail="redis unavailable")
    await state.rds.hset("vids", body.video_id, body.file_id)
    if body.message_id is not None:
        await state.rds.hset("vid_msgs", body.video_id, int(body.message_id))
    if body.size:
        await state.rds.hset("vid_sizes", body.video_id, int(body.size))
    return {"ok": True, "video_id": body.video_id, "file_id": body.file_id}
