"""
Keep CORS headers on error responses.

Starlette builds the middleware stack as::

    ServerErrorMiddleware  <- outermost, turns an unescaped exception into a 500
      -> CORSMiddleware
        -> ExceptionMiddleware
          -> router

`ServerErrorMiddleware` is *outside* every user middleware, so a response it
builds never passes through `CORSMiddleware`.  Any exception a route lets
escape therefore reaches the browser **without** `Access-Control-Allow-Origin`,
and the browser reports it as a CORS problem — `No 'Access-Control-Allow-
Origin' header is present on the requested resource` — while the real failure
(a dead CDN connection, Redis down, a file that vanished) stays invisible.

This middleware is registered *inside* the CORS layer (see `__main__.py`, it
is added before `CORSMiddleware` and Starlette wraps the stack in reverse), so
its answer still gets the CORS headers and the client can read what happened.
"""

import logging

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger(__name__)


class CatchAllErrors:
    """Answer exceptions that escape the router with a readable JSON 500."""

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
                # the client sees a message instead of a CORS failure
                await JSONResponse(
                    {"detail": "Internal server error"}, status_code=500
                )(scope, receive, send)
            elif not finished:
                # mid stream (the audio relay died half way through): close
                # the response cleanly, the client reports a read error and
                # retries — sending a second response start would be a
                # protocol error
                await send({"type": "http.response.body", "body": b""})
            # started and finished: the answer was complete, nothing to add
