"""
Duration filtering.

Tracks longer than one hour (3600 seconds) are ignored everywhere: search
results, home rows, watch/related lists, playlists, and the audio endpoints
themselves.  The helpers here are deliberately generic so they can be plugged
into the response sanitizer (which walks every payload) as well as into the
streaming path (which knows the real duration before downloading).
"""

MAX_DURATION_SECONDS = 3600

# Keys that YouTube Music uses to expose a duration, in resolution order.
_DURATION_KEYS = (
    "duration_seconds",
    "duration",
    "length_seconds",
    "length",
    "lengthSeconds",
)


class DurationLimitExceeded(ValueError):
    """Raised when an audio item is longer than :data:`MAX_DURATION_SECONDS`."""

    def __init__(self, video_id: str, seconds: float | None = None):
        self.video_id = video_id
        self.seconds = seconds
        detail = f" ({int(seconds)}s)" if seconds else ""
        super().__init__(
            f"Track {video_id} lasts longer than one hour{detail} and is not served"
        )


def parse_duration_seconds(value) -> int | None:
    """
    Normalize a duration to whole seconds.

    Accepts integers/seconds (``303``), numeric strings (``"303"``) and
    colon separated clocks (``"5:03"``, ``"1:00:01"``).  Anything else
    (free text such as ``"1 hour, 17 minutes"``) returns ``None``.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.isdigit():
            return int(text)
        parts = text.split(":")
        if 1 < len(parts) <= 4 and all(part.strip().isdigit() for part in parts):
            seconds = 0
            for part in parts:
                seconds = seconds * 60 + int(part.strip())
            return seconds
    return None


def duration_of(item: dict) -> int | None:
    """Return the duration of *item* in seconds, or ``None`` when unknown."""
    for key in _DURATION_KEYS:
        if key in item:
            seconds = parse_duration_seconds(item.get(key))
            if seconds is not None:
                return seconds
    return None


def is_music_track(item) -> bool:
    """
    True when *item* looks like a playable song.

    Podcast episodes and other non music entries are exempt from the one hour
    rule — they are expected to be long.
    """
    if not isinstance(item, dict):
        return False

    video_id = item.get("videoId")
    if not isinstance(video_id, str) or not video_id:
        return False

    if "podcast" in item or "episode" in item:
        return False

    browse_id = item.get("browseId")
    if isinstance(browse_id, str) and browse_id.startswith("MPED"):
        return False  # podcast episode browse id

    video_type = item.get("videoType")
    if isinstance(video_type, str) and (
        "PODCAST" in video_type or "EPISODE" in video_type
    ):
        return False

    return True


def exceeds_duration_limit(item: dict) -> bool:
    """True when *item* is a music track longer than one hour."""
    if not is_music_track(item):
        return False
    seconds = duration_of(item)
    return seconds is not None and seconds > MAX_DURATION_SECONDS


def strip_long_tracks(data):
    """
    Recursively remove every music track longer than one hour.

    Works on any payload shape: lists of tracks (search, watch, playlists,
    related), nested rows (home page) and dicts that hold a track as a value.
    """
    if isinstance(data, list):
        return [
            strip_long_tracks(entry)
            for entry in data
            if not (isinstance(entry, dict) and exceeds_duration_limit(entry))
        ]
    if isinstance(data, dict):
        return {
            key: strip_long_tracks(value)
            for key, value in data.items()
            if not (isinstance(value, dict) and exceeds_duration_limit(value))
        }
    return data
