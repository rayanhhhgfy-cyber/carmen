"""
Keep every response readable from the browser.

This middleware does two things, both in service of the same symptom — the
browser reporting ``No 'Access-Control-Allow-Origin' header is present on the
requested resource`` instead of the real failure:

1. **Answer the exceptions that escape the router.**  Starlette builds the
   middleware stack as::

       ServerErrorMiddleware  <- outermost, turns an escaped exception into a 500
         -> CORSMiddleware
           -> ExceptionMiddleware
             -> router

   ``ServerErrorMiddleware`` is *outside* every user middleware, so a response
   it builds never passes through ``CORSMiddleware``.  Any exception a route
   lets escape therefore reaches the browser without ``Access-Control-Allow-
   Origin`` — the client sees a CORS problem while the real failure (a dead CDN
   connection, Redis down, a file that vanished) stays invisible.

   This middleware is registered *inside* the CORS layer (see ``__main__.py``:
   it is added before ``CORSMiddleware`` and Starlette wraps the stack in
   reverse), so its answer still travels through the CORS layer.

2. **Stamp the CORS headers on every response, even responses to requests that
   carried no ``Origin`` header.**  ``CORSMiddleware`` leaves those untouched —
   a bare ``<audio src>`` request sends no ``Origin`` — so the player's own
   stream requests used to answer with a perfectly cacheable
   ``Cache-Control: max-age=3600`` response that had no
   ``Access-Control-Allow-Origin``.  The browser stores that response, and the
   download's ``fetch()`` of the same URL then *reuses* it: the reuse is judged
   against the stored headers, finds no allow-origin, and is blocked.  That is
   exactly why downloading a song already played failed while a never-played
   song worked.  With the headers on every response, anything the browser
   caches is safe to reuse.
"""

import logging

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger(__name__)

#: The one list ``CORSMiddleware`` is configured with (see ``__main__.py``);
#: kept here so the stamped headers and the configured ones cannot drift.
EXPOSE_HEADERS = [
    "Accept-Ranges",
    "Content-Length",
    "Content-Range",
    "ETag",
    "Last-Modified",
]

_ALLOW_ORIGIN = b"access-control-allow-origin"
_ALLOW_EXPOSE = b"access-control-expose-headers"


def stamp_cors(message: Message) -> None:
    """Give an ``http.response.start`` message the CORS headers it lacks.

    ``CORSMiddleware`` sits outside this middleware and *replaces* the headers
    it owns (``MutableHeaders.update`` drops the previous value first), so the
    pair never ends up duplicated on a request that did carry an ``Origin``.
    """
    headers = message.setdefault("headers", [])
    present = {key.lower() for key, _ in headers}
    if _ALLOW_ORIGIN not in present:
        headers.append((_ALLOW_ORIGIN, b"*"))
    if _ALLOW_EXPOSE not in present:
        headers.append((_ALLOW_EXPOSE, ", ".join(EXPOSE_HEADERS).encode("latin-1")))


class CatchAllErrors:
    """Answer exceptions that escape the router, and keep CORS headers on."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = False
        finished = False

        async def send_wrapper(message: Message) -> None:
            nonlocal started, finished
            if message["type"] == "http.response.start":
                started = True
                stamp_cors(message)
            elif message["type"] == "http.response.body" and not message.get(
                "more_body", False
            ):
                finished = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            log.exception(
                "Unhandled error on %s %s",
                scope.get("method"),
                scope.get("path"),
            )
            if not started:
                # nothing on the wire yet: answer inside the CORS layer so
                # the client sees a message instead of a CORS failure — the
                # wrapper does the stamping, this response must not bypass it
                await JSONResponse(
                    {"detail": "Internal server error"}, status_code=500
                )(scope, receive, send_wrapper)
            elif not finished:
                # mid stream (the audio relay died half way through): close
                # the response cleanly, the client reports a read error and
                # retries — sending a second response start would be a
                # protocol error
                await send({"type": "http.response.body", "body": b""})
            # started and finished: the answer was complete, nothing to add
