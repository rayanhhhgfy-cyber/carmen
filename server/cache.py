import hashlib
import json
import logging
import time
from functools import wraps

from . import state
from .debuglog import enabled as debug_enabled, fmt_ms

log = logging.getLogger(__name__)


def make_cache_key(prefix: str, *args, **kwargs) -> str:
    """Hashed key: stable for any argument shape (queries, mixed params)."""
    raw = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, default=str)
    h = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f"yt:{prefix}:{h}"


def make_id_key(prefix: str, id_value: str, *extra: object) -> str:
    """
    Readable key for a single stable id: ``yt:{prefix}:{id}``.

    Some extra args change the payload (a different ``limit`` or ``params``)
    and are appended only when they differ from the default, so the common
    call keeps the clean ``yt:vid:VIDEOID`` form while variants stay distinct.
    """
    parts = [str(id_value)]
    for value in extra:
        text = str(value)
        if text and text != "None":
            parts.append(text)
    return ":".join([f"yt:{prefix}", *parts])


def cached(
    prefix: str,
    ttl: int = 300,
    id_arg: str | None = None,
    extra_args: tuple[str, ...] = (),
):
    """
    Decorator that caches an async function's return value in Redis.

    :param prefix: cache key prefix (e.g. "home", "song", "artist")
    :param ttl: time-to-live in seconds (default 300 = 5 min)
    :param id_arg: name of the keyword that holds a stable id — when given,
        the key becomes the readable ``yt:{prefix}:{id}`` instead of a hash,
        so a record can be located or invalidated directly.
    :param extra_args: additional keyword names that distinguish otherwise
        identical payloads (e.g. the paging ``params`` token); only these are
        appended to the id key, the rest of the kwargs are ignored.
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            rds = state.rds
            if rds is None:
                if debug_enabled():
                    log.info("cache bypass %s — no redis client", func.__name__)
                return await func(*args, **kwargs)

            if id_arg and id_arg in kwargs:
                extras = [kwargs[name] for name in extra_args if name in kwargs]
                key = make_id_key(prefix, kwargs[id_arg], *extras)
            else:
                key = make_cache_key(prefix, *args, **kwargs)
            debug = debug_enabled()
            try:
                cached = await rds.get(key)
                if cached is not None:
                    if debug:
                        log.info(
                            "cache hit  %s · %s · %s",
                            func.__name__,
                            key,
                            f"{len(cached)} B",
                        )
                    return json.loads(cached)
            except Exception as exc:  # noqa: BLE001
                if debug:
                    log.info(
                        "cache fail %s · %s — serving uncached: %s",
                        func.__name__,
                        key,
                        exc,
                    )
                return await func(*args, **kwargs)

            if debug:
                started = time.perf_counter()
            result = await func(*args, **kwargs)

            try:
                await rds.set(key, json.dumps(result, default=str), ex=ttl)
            except Exception:
                pass

            if debug:
                log.info(
                    "cache miss  %s · %s → stored · origin %s · ttl %ss",
                    func.__name__,
                    key,
                    fmt_ms((time.perf_counter() - started) * 1000),
                    ttl,
                )

            return result

        return wrapper

    return decorator
