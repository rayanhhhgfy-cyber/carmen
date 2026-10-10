"""
Opt-in debug logging for the API — ``DEBUG_LOGS=1 ./venv/bin/python -m server``.

When the flag is set the process reconfigures logging so every line the
server produces is actually shown — uvicorn's default ``dictConfig`` leaves
the root logger at WARNING, which silently drops the ``log.info`` calls
spread through the routes — and it prints them in a compact TUI style::

    14:22:31.123 INF  stream    │ stream -MtKC5wXqdQ → telegram (msg 42) · 14.2 ms
    14:22:31.400 INF  http      │ GET    /stream?vidId=-MtKC5wXqdQ  206 · 1284.3 ms · exec q1
    14:22:31.510 DBG  debug     │ resolve -MtKC5wXqdQ ✓ 132.5 ms

The module exposes the small helpers the routes call:

* :func:`tier` — where a stream was served from and how long it took;
* :func:`timed` — wraps a slow call and logs ``label ✓ 12.4 ms``;
* :func:`banner` — the startup block with port / redis / telegram state;
* :class:`RequestTimer` — ASGI middleware logging one line per request,
  measured to the last body byte (installed only when the flag is on).

With ``DEBUG_LOGS`` unset nothing here runs: the helpers return immediately,
the middleware is never added and the logging configuration stays exactly as
uvicorn sets it up, so normal output is unchanged.  ``NO_COLOR`` (and
``TERM=dumb``) switch the ANSI colors off while keeping the lines.
"""

import logging
import os
import sys
import time
from contextlib import contextmanager

from . import state

TRUE_VALUES = {"1", "true", "yes", "on"}

_log = logging.getLogger("server.debug")
_http_log = logging.getLogger("server.http")
_enabled: bool | None = None

_COLOR = not os.environ.get("NO_COLOR") and os.environ.get("TERM") != "dumb"


def enabled() -> bool:
    """Whether ``DEBUG_LOGS`` asked for the verbose output (read once)."""
    global _enabled
    if _enabled is None:
        _enabled = os.environ.get("DEBUG_LOGS", "").strip().lower() in TRUE_VALUES
    return _enabled


def _paint(code: str, text: str) -> str:
    return f"\x1b[{code}m{text}\x1b[0m" if _COLOR else text


def fmt_ms(ms: float) -> str:
    """``12.4 ms`` / ``1.25 s`` — one glanceable token either way."""
    if ms >= 1000:
        return f"{ms / 1000:.2f} s"
    return f"{ms:.1f} ms"


def fmt_bytes(size: int) -> str:
    """``3753890 B`` reads as ``3.58 MiB``."""
    value = float(size)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024 or unit == "GiB":
            return f"{int(value)} {unit}" if unit == "B" else f"{value:.2f} {unit}"
        value /= 1024
    return f"{int(size)} B"


class _Formatter(logging.Formatter):
    """``HH:MM:SS.mmm LVL logger │ message`` — colors when not disabled."""

    _BADGE = {
        "DEBUG": "DBG",
        "INFO": "INF",
        "WARNING": "WRN",
        "ERROR": "ERR",
        "CRITICAL": "CRT",
    }
    _LEVEL_COLOR = {
        "DEBUG": "2",
        "INFO": "36",
        "WARNING": "33",
        "ERROR": "31",
        "CRITICAL": "1;31",
    }

    def format(self, record: logging.LogRecord) -> str:
        stamp = time.strftime("%H:%M:%S", time.localtime(record.created))
        stamp = f"{stamp}.{int(record.msecs):03d}"
        level = record.levelname
        message = record.getMessage()
        if record.exc_info:
            message += "\n" + self.formatException(record.exc_info)
        return (
            f"{_paint('2', stamp)} "
            f"{_paint(self._LEVEL_COLOR.get(level, '0'), self._BADGE.get(level, level[:3]))} "
            f"{_paint('36', record.name.split('.')[-1].ljust(9))}"
            f"{_paint('2', '│')} {message}"
        )


def configure() -> None:
    """Root logger → DEBUG with the TUI formatter; call before serving."""
    if not enabled():
        return
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_Formatter())
    root.addHandler(handler)

    # The RequestTimer middleware replaces uvicorn's own access line, and its
    # dictConfig (skipped via ``log_config=None``) would otherwise re-add it.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    # Their DEBUG is raw header/byte dumps, not application flow.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.INFO)


def request(scope, status: int, ms: float) -> None:
    """The per-request line: ``GET /path 206 · 1284.3 ms · exec q1``."""
    if not enabled():
        return
    method = str(scope.get("method", "?"))
    path = str(scope.get("path", "/"))
    query = scope.get("query_string", b"")
    if query:
        path = f"{path}?{query.decode('latin-1', 'replace')}"
    if len(path) > 80:
        path = f"{path[:77]}..."
    code = int(status) or 499  # never started = the client gave up first
    color = "32" if code < 300 else "36" if code < 400 else "33" if code < 500 else "31"
    try:
        queue = state.executor._work_queue.qsize()
    except Exception:  # noqa: BLE001
        queue = 0
    tail = f"· {fmt_ms(ms)}" + (f" · exec q{queue}" if queue else "")
    line = (
        f"{_paint('1', method.ljust(6))}{path}  "
        f"{_paint(color, str(code))} {_paint('2', tail)}"
    )
    if path.startswith("/stream/status"):
        line = _paint("2", line)  # polled during every download — dim it
    _http_log.info("%s", line)


class RequestTimer:
    """
    ASGI middleware: one line per request, measured to the last body byte.

    A streaming response (``/stream``) therefore reports its real total
    instead of the time-to-headers.  Only :func:`enabled` ever runs it —
    ``server.__main__`` adds it to the stack solely when ``DEBUG_LOGS`` is on.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or not enabled():
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 0
        finished = False

        async def send_wrapper(message):
            nonlocal status, finished
            kind = message["type"]
            if kind == "http.response.start":
                status = message["status"]
            elif kind == "http.response.body" and not message.get("more_body"):
                if not finished:
                    finished = True
                    request(scope, status, (time.perf_counter() - started) * 1000)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            # The client hung up mid-stream (or an error escaped) — still
            # show the line so the partial request is accounted for.
            if not finished:
                request(scope, status, (time.perf_counter() - started) * 1000)


_TIER_COLOR = {
    "disk-cache": "32",
    "telegram": "35",
    "relay": "36",
    "download": "33",
    "error": "31",
}


def tier(vid_id: str, source: str, since: float, detail: str = "", logger=None) -> None:
    """
    Which tier answered a ``/stream`` request, and how long it took.

    ``since`` is a ``time.perf_counter()`` snapshot taken when the route
    started; ``source`` picks the color (disk-cache, telegram, relay,
    download, error).
    """
    if not enabled():
        return
    ms = (time.perf_counter() - since) * 1000
    extra = f" ({detail})" if detail else ""
    (logger or _log).info(
        "stream %s → %s%s · %s",
        vid_id,
        _paint(_TIER_COLOR.get(source, "0"), source),
        extra,
        fmt_ms(ms),
    )


@contextmanager
def timed(label: str, logger=None):
    """Log ``label ✓ 12.4 ms`` when the wrapped block finishes (or fails)."""
    if not enabled():
        yield
        return
    started = time.perf_counter()
    try:
        yield
    finally:
        (logger or _log).debug(
            "%s ✓ %s", label, fmt_ms((time.perf_counter() - started) * 1000)
        )


def banner(title: str, rows) -> None:
    """The startup block — ``rows`` is a sequence of ``(label, value)``."""
    if not enabled():
        return
    label_w = max((len(label) for label, _ in rows), default=0)
    width = max([len(title) + 4] + [label_w + 2 + len(value) for _, value in rows])
    edge = _paint("36", "│")
    print()
    print(
        _paint("36", "┌─ ")
        + _paint("1;36", title)
        + _paint("36", " ")
        + _paint("36", "─" * max(width - len(title) - 4, 1))
    )
    for label, value in rows:
        print(f"{edge}  {_paint('2', label.ljust(label_w))}  {value}")
    print(_paint("36", "└" + "─" * max(width - 1, 1)))
    print()
