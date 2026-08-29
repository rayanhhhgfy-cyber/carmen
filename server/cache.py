import hashlib
import json
from functools import wraps

from . import state


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
                return await func(*args, **kwargs)

            key = make_cache_key(prefix, *args, **kwargs)
            try:
                cached = await rds.get(key)
                if cached is not None:
                    return json.loads(cached)
            except Exception:
                return await func(*args, **kwargs)

            result = await func(*args, **kwargs)

            try:
                await rds.set(key, json.dumps(result, default=str), ex=ttl)
            except Exception:
                pass

            return result

        return wrapper

    return decorator
