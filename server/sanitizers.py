import re
from functools import wraps
from urllib.parse import urlparse

from .filters import strip_long_tracks

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

# i.ytimg.com keeps every thumbnail twice: /vi_webp/<id>/<size>.webp and
# /vi/<id>/<size>.jpg
WEBP_PATH_RE = re.compile(
    r"/vi_webp/(?P<name>[^?#]+)\.webp(?P<tail>[?#][^#\s]*)?$", re.IGNORECASE
)
WEBP_EXT_RE = re.compile(r"\.webp(?=[?#][^#\s]*$|$)", re.IGNORECASE)


def as_jpg(url: str) -> str:
    """
    Swap a WebP answer for its JPEG twin.

    ``i.ytimg.com/vi_webp/<id>/<size>.webp`` becomes
    ``i.ytimg.com/vi/<id>/<size>.jpg`` and any other ``….webp`` URL simply
    loses the extension.  WebP does not paint reliably in every browser, so
    only JPEG ever leaves the API.
    """
    if ".webp" not in url:
        return url
    match = WEBP_PATH_RE.search(url)
    if match:
        tail = match.group("tail") or ""
        return f"{url[:match.start()]}/vi/{match.group('name')}.jpg{tail}"
    return WEBP_EXT_RE.sub(".jpg", url)


def is_thumbnail_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.hostname in ALLOWED_URL_DOMAINS
    except Exception:
        return False


def sanitize_url(url: str) -> str | None:
    if not isinstance(url, str):
        return url
    if url.startswith(("http://", "https://")):
        url = as_jpg(url)
    if is_thumbnail_url(url):
        return url
    if SENSITIVE_URL_PATTERNS.search(url):
        return None
    return url


def sanitize_value(value):
    if isinstance(value, str):
        # `thumbnail`, `artwork`, … : same WebP -> JPEG swap as `url` keys
        if value.startswith(("http://", "https://")):
            value = as_jpg(value)
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
    """
    Scrub tracking/streaming data and drop tracks longer than one hour.

    Every route is wrapped with :func:`sanitized`, so applying the duration
    filter here guarantees the "> 1 hour" rule holds for every payload that
    leaves the API (search, home, watch, playlists, related, suggestions, ...).
    """
    data = strip_long_tracks(data)
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
