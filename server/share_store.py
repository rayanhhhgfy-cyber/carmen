"""
Playlist share registry — the persistence half of shareable playlists.

A tiny JSON-file store (the reference app this feature is ported from keeps
``data/shared_playlists.json`` the same way): each shared playlist lives
under a stable code (``pl_`` + 12 base62 chars) so a link keeps working
while its owner re-shares an updated copy under the same code.

- Path: env ``CARMEN_SHARE_STORE``, default
  ``<server>/data/shared_playlists.json`` (directory created on demand).
- Writes are atomic (tmp file in the same directory + ``os.replace``) and
  serialised through a thread lock, so concurrent shares never interleave
  a half-written file.
- ``sharedAt`` is stamped here (ISO UTC) on every create/update, so any
  caller of :func:`create_or_update` gets the refresh-on-update behaviour.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import string
import threading
from datetime import datetime, timezone
from pathlib import Path

_CODE_RE = re.compile(r"^pl_[A-Za-z0-9]{8,32}$")
_BASE62 = string.ascii_letters + string.digits  # A-Z a-z 0-9
_CODE_SUFFIX_LEN = 12

_LOCK = threading.Lock()


def store_path() -> Path:
    """Registry file location — env override wins, read on every call."""
    override = os.environ.get("CARMEN_SHARE_STORE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "data" / "shared_playlists.json"


def is_valid_code(code: object) -> bool:
    return isinstance(code, str) and bool(_CODE_RE.match(code))


def generate_code() -> str:
    """A fresh ``pl_`` + 12-char base62 code (cryptographically random)."""
    return "pl_" + "".join(secrets.choice(_BASE62) for _ in range(_CODE_SUFFIX_LEN))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_all(path: Path) -> dict:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    try:
        data = json.loads(raw or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _save_all(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp-{secrets.token_hex(4)}")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def create_or_update(code: str | None, payload: dict) -> str:
    """
    Store *payload* under *code*, generating a code when ``code is None``.

    A supplied code must match ``^pl_[A-Za-z0-9]{8,32}$`` — anything else
    raises :class:`ValueError`. Re-using an existing code replaces the
    stored copy in place (the link stays stable); ``sharedAt`` is refreshed
    either way. Returns the code the payload lives under.
    """
    if code is not None and not is_valid_code(code):
        raise ValueError(
            f"Invalid share code {code!r}: expected 'pl_' followed by "
            "8-32 letters or digits."
        )
    with _LOCK:
        path = store_path()
        data = _load_all(path)
        if code is None:
            code = generate_code()
            while code in data:  # astronomically unlikely, but free to check
                code = generate_code()
        stored = dict(payload)
        stored["code"] = code
        stored["sharedAt"] = _now_iso()
        data[code] = stored
        _save_all(path, data)
        return code


def get(code: str) -> dict | None:
    """The stored payload for *code*, or ``None`` when unknown."""
    if not isinstance(code, str) or not code:
        return None
    with _LOCK:
        data = _load_all(store_path())
    entry = data.get(code)
    return dict(entry) if isinstance(entry, dict) else None
