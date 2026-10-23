"""
Shareable playlist routes — the registry half of playlist sharing.

- ``POST /share/playlists`` — create a shared copy of a playlist, or update
  it in place when the body carries the playlist's existing ``code`` (the
  share link is stable per playlist). Answers ``{"code": …}``.
- ``GET /share/playlists/{code}`` — resolve a code back to the stored
  payload (``{code, name, description, artwork, tracks, sharedAt}``), or
  404 for an unknown code.

Persistence lives in :mod:`server.share_store` (JSON file, atomic writes);
this module is only validation + HTTP shape. No Redis caching and no
sanitizer pass: a shared copy must come back exactly as its owner posted
it, and it can change at any time.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .. import share_store

router = APIRouter(prefix="/share", tags=["Share"])

MAX_SHARED_TRACKS = 500
_CODE_PATTERN = r"^pl_[A-Za-z0-9]{8,32}$"


class ShareTrack(BaseModel):
    """One track of a shared playlist — the client's own track metadata."""

    model_config = ConfigDict(extra="allow")

    videoId: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    artists: list[str] | None = None
    artist: str | None = None
    album: str | None = None
    duration: str | None = None
    durationSeconds: int | None = None
    artwork: str | None = None
    year: int | None = None
    isExplicit: bool | None = None


class SharePlaylistIn(BaseModel):
    """Body of ``POST /share/playlists``."""

    model_config = ConfigDict(extra="allow")

    code: str | None = Field(default=None, pattern=_CODE_PATTERN)
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    artwork: str | None = None
    tracks: list[ShareTrack] = Field(default_factory=list, max_length=MAX_SHARED_TRACKS)


@router.post(
    "/playlists",
    summary="Share a playlist",
    response_description="The share code the playlist lives under",
)
async def share_playlist(body: SharePlaylistIn):
    """
    Create (or, with an existing ``code``, update) a shared playlist copy.

    - **code**: optional — omit it to mint a fresh code; pass the code a
      previous share returned to refresh that link's copy in place.
    - **name**: 1–200 chars. **tracks**: at most 500 items.
    """
    payload = {
        "name": body.name,
        "description": body.description,
        "artwork": body.artwork,
        "tracks": [
            track.model_dump(exclude_none=True) for track in body.tracks
        ],
    }
    try:
        code = share_store.create_or_update(body.code, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"code": code}


@router.get(
    "/playlists/{code}",
    summary="Resolve a shared playlist",
    response_description="The stored shared playlist payload",
)
async def resolve_shared_playlist(code: str):
    """Return the payload stored under *code*, or 404 when unknown."""
    stored = share_store.get(code)
    if stored is None:
        raise HTTPException(status_code=404, detail="Shared playlist not found.")
    # Normalise the outward shape even for entries written by older builds.
    return {
        "code": stored.get("code", code),
        "name": stored.get("name", ""),
        "description": stored.get("description"),
        "artwork": stored.get("artwork"),
        "tracks": stored.get("tracks", []),
        "sharedAt": stored.get("sharedAt"),
    }
