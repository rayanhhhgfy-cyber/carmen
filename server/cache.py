import hashlib
import json
import logging
import time
from functools import wraps

from . import state
from .debuglog import enabled as debug_enabled, fmt_ms

log = logging.getLogger(__name__)


def make_cache_key(prefix: str, *args, **kwargs) -> str:
    raw = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, default=str)
    h = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f"yt:{prefix}:{h}"


def cached(prefix: str, ttl: int = 300):
    """
    Decorator that caches an async function's return value in Redis.

    :param prefix: cache key prefix (e.g. "home", "song", "artist")
    :param ttl: time-to-live in seconds (default 300 = 5 min)
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            rds = state.rds
            if rds is None:
                if debug_enabled():
                    log.info("cache bypass %s — no redis client", func.__name__)
                return await func(*args, **kwargs)

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
