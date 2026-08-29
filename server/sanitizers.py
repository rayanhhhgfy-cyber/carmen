import re
from functools import wraps
from urllib.parse import urlparse

# Keys to remove entirely from any dict
SENSITIVE_KEYS = {
    "feedbackTokens",
    "listenAgainFeedbackTokens",
    "signatureCipher",
    "trackingParams",
    "contextParams",
    "playbackTracking",
    "serializedShareEntity",
    "shareUrl",
    "playerConfig",
    "clientConfig",
    "serviceIntegrityDimensions",
    "attribution",
}

# Patterns in keys that indicate sensitive data
SENSITIVE_KEY_PATTERNS = re.compile(
    r"(token|cipher|tracking|context[Pp]aram|signature|playback[Tt]racking)",
    re.IGNORECASE,
)

# Allowed URL domains (thumbnails and public assets)
ALLOWED_URL_DOMAINS = {
    "yt3.googleusercontent.com",
    "i.ytimg.com",
}

# URL patterns to scrub (streaming URLs, googlevideo, etc.)
SENSITIVE_URL_PATTERNS = re.compile(
    r"(googlevideo\.com|videoplayback|rr\d+---sn-|signatureCipher)",
    re.IGNORECASE,
)


def is_thumbnail_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.hostname in ALLOWED_URL_DOMAINS
    except Exception:
        return False


def sanitize_url(url: str) -> str | None:
    if not isinstance(url, str):
        return url
    if is_thumbnail_url(url):
        return url
    if SENSITIVE_URL_PATTERNS.search(url):
        return None
    return url


def sanitize_value(value):
    if isinstance(value, str):
        if SENSITIVE_URL_PATTERNS.search(value):
            return None
        return value
    if isinstance(value, dict):
        return sanitize_dict(value)
    if isinstance(value, list):
        return sanitize_list(value)
    return value


def sanitize_dict(d: dict) -> dict:
    result = {}
    for key, value in d.items():
        if key in SENSITIVE_KEYS:
            continue
        if SENSITIVE_KEY_PATTERNS.search(key):
            continue
        if key == "url" and isinstance(value, str):
            sanitized = sanitize_url(value)
            if sanitized is None:
                continue
            result[key] = sanitized
        elif isinstance(value, dict):
            sanitized = sanitize_dict(value)
            if sanitized:
                result[key] = sanitized
        elif isinstance(value, list):
            result[key] = sanitize_list(value)
        else:
            result[key] = value
    return result


def sanitize_list(items: list) -> list:
    result = []
    for item in items:
        if isinstance(item, dict):
            sanitized = sanitize_dict(item)
            if sanitized:
                result.append(sanitized)
        elif isinstance(item, str):
            if not SENSITIVE_URL_PATTERNS.search(item):
                result.append(item)
        else:
            result.append(item)
    return result


def sanitize(data):
    if isinstance(data, dict):
        return sanitize_dict(data)
    if isinstance(data, list):
        return sanitize_list(data)
    return data


def sanitized(func):
    """Decorator that sanitizes the return value of an async function."""

    @wraps(func)
    async def wrapper(*args, **kwargs):
        result = await func(*args, **kwargs)
        return sanitize(result)

    return wrapper
