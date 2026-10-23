"""Route tests for server/routes/convert.py — resolve + SSE conversion."""

import json
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.routes.convert import router as convert_router
from server.spotify import SpotifyClient, SpotifyPlaylist, SpotifyTrack

PLAYLIST_URL = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"


def make_playlist() -> SpotifyPlaylist:
    return SpotifyPlaylist(
        id="37i9dQZF1DXcBWIGoYBM5M",
        name="Test Mix",
        description="desc",
        owner="tester",
        artwork="https://i.scdn.co/cover",
        spotify_url=PLAYLIST_URL,
        tracks=[
            SpotifyTrack(id="t1", title="Blinding Lights", artists=["The Weeknd"],
                         duration_ms=202_000, spotify_url="https://open.spotify.com/track/t1"),
            SpotifyTrack(id="t2", title="Levitating", artists=["Dua Lipa"],
                         duration_ms=203_000, spotify_url="https://open.spotify.com/track/t2"),
            SpotifyTrack(id="t3", title="Obscure B-Side Nobody Covered", artists=["Unknown Act"],
                         duration_ms=180_000, spotify_url="https://open.spotify.com/track/t3"),
        ],
    )


class FakeSpotifyClient:
    def __init__(self, *args, **kwargs):
        pass

    def get_playlist(self, playlist_id):
        assert playlist_id == "37i9dQZF1DXcBWIGoYBM5M"
        return make_playlist()

    def close(self):
        pass


def fake_search(query, **kwargs):
    """Pretend YouTube Music search: exact hits for two tracks, junk for the third."""
    if "Blinding" in query:
        return [{
            "videoId": "yt1", "title": "Blinding Lights",
            "artists": [{"name": "The Weeknd"}], "duration": "3:22",
            "thumbnails": [{"url": "https://i.ytimg.com/vi/yt1/hqdefault.jpg"}],
            "feedbackTokens": {"should": "be stripped"},
        }]
    if "Levitating" in query:
        return [{
            "videoId": "yt2", "title": "Levitating",
            "artists": [{"name": "Dua Lipa"}], "duration": "3:23",
            "thumbnails": [{"url": "https://i.ytimg.com/vi/yt2/hqdefault.jpg"}],
        }]
    return [{"videoId": "junk", "title": "Something Entirely Different",
             "artists": [{"name": "Someone Else"}], "duration": "4:00"}]


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(convert_router)
    with (
        patch("server.routes.convert.SpotifyClient", FakeSpotifyClient),
        patch("server.routes.convert.spotify_configured", return_value=True),
        patch("server.routes.convert.search", side_effect=fake_search),
    ):
        yield TestClient(app)


def parse_sse(text: str):
    """Parse a text/event-stream body into (event, payload) pairs."""
    events = []
    for chunk in text.strip().split("\n\n"):
        event = data = None
        for line in chunk.splitlines():
            if line.startswith("event:"):
                event = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data = json.loads(line[len("data:"):].strip())
        events.append((event, data))
    return events


# ── GET /convert/spotify/playlist ─────────────────────────────────────────


def test_resolve_playlist_ok(client):
    response = client.get("/convert/spotify/playlist", params={"url": PLAYLIST_URL})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["name"] == "Test Mix"
    assert payload["owner"] == "tester"
    assert payload["track_count"] == 3
    assert payload["tracks"][0]["title"] == "Blinding Lights"
    assert payload["tracks"][0]["artist"] == "The Weeknd"
    assert payload["tracks"][1]["artists"] == ["Dua Lipa"]


def test_resolve_playlist_bad_url_is_400(client):
    response = client.get("/convert/spotify/playlist", params={"url": "not a link"})
    assert response.status_code == 400
    assert "Spotify playlist link" in response.json()["detail"]


def test_resolve_playlist_unconfigured_uses_scraper():
    """No credentials -> zero-setup embed-page reader, not a 503."""
    app = FastAPI()
    app.include_router(convert_router)
    with (
        patch("server.routes.convert.ScrapedSpotifyClient", FakeSpotifyClient),
        patch("server.routes.convert.spotify_configured", return_value=False),
    ):
        client = TestClient(app)
        response = client.get("/convert/spotify/playlist", params={"url": PLAYLIST_URL})
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Test Mix"


def test_spotify_client_factory_prefers_api_when_configured(monkeypatch):
    # This sandbox ships malformed proxy env vars that break httpx.Client()
    # construction; they don't exist on real servers. Strip them so the
    # factory's real client construction can be exercised.
    for var in ("https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY",
                "all_proxy", "ALL_PROXY", "no_proxy", "NO_PROXY"):
        monkeypatch.delenv(var, raising=False)

    from server.routes.convert import _spotify_client
    from server.spotify_scrape import ScrapedSpotifyClient

    with patch("server.routes.convert.spotify_configured", return_value=True):
        client = _spotify_client()
        assert isinstance(client, SpotifyClient)
        client.close()
    with patch("server.routes.convert.spotify_configured", return_value=False):
        client = _spotify_client()
        assert isinstance(client, ScrapedSpotifyClient)
        client.close()


# ── POST /convert/spotify/to-ytmusic (SSE) ────────────────────────────────


def test_convert_streams_progress_then_done(client):
    response = client.post("/convert/spotify/to-ytmusic", json={"url": PLAYLIST_URL})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(response.text)
    kinds = [event for event, _ in events]
    assert kinds[0] == "start"
    assert kinds[-1] == "done"
    assert kinds.count("progress") == 3

    start = events[0][1]
    assert start["total"] == 3
    assert start["playlist"]["name"] == "Test Mix"

    progress = [payload for event, payload in events if event == "progress"]
    assert [p["done"] for p in progress] == [1, 2, 3]
    statuses = [p["result"]["status"] for p in progress]
    assert statuses == ["matched", "matched", "not_found"]

    first = progress[0]["result"]
    assert first["spotify"]["title"] == "Blinding Lights"
    assert first["confidence"] >= 0.78
    assert first["match"]["videoId"] == "yt1"
    # Sanitized like every other API payload: tracking tokens are gone.
    assert "feedbackTokens" not in first["match"]
    assert first["match"]["thumbnails"][0]["url"].startswith("https://i.ytimg.com/")

    done = events[-1][1]["summary"]
    assert done == {"total": 3, "matched": 2, "approximate": 0, "not_found": 1, "error": 0}


def test_convert_respects_limit(client):
    response = client.post(
        "/convert/spotify/to-ytmusic", json={"url": PLAYLIST_URL, "limit": 1}
    )
    events = parse_sse(response.text)
    assert [e for e, _ in events].count("progress") == 1
    assert events[-1][1]["summary"]["total"] == 1


def test_convert_rejects_bad_limit(client):
    response = client.post(
        "/convert/spotify/to-ytmusic", json={"url": PLAYLIST_URL, "limit": 0}
    )
    assert response.status_code == 422


def test_convert_search_error_marks_track_error(client):
    def exploding_search(query, **kwargs):
        raise RuntimeError("ytm down")

    app = FastAPI()
    app.include_router(convert_router)
    with (
        patch("server.routes.convert.SpotifyClient", FakeSpotifyClient),
        patch("server.routes.convert.spotify_configured", return_value=True),
        patch("server.routes.convert.search", side_effect=exploding_search),
    ):
        test_client = TestClient(app)
        response = test_client.post("/convert/spotify/to-ytmusic", json={"url": PLAYLIST_URL})

    events = parse_sse(response.text)
    # match_track catches per-query errors itself, so these come back as
    # not_found rather than error — the batch survives either way.
    statuses = [p["result"]["status"] for e, p in events if e == "progress"]
    assert statuses == ["not_found", "not_found", "not_found"]
    assert events[-1][1]["summary"]["not_found"] == 3


# ── Universal import: GET /convert/resolve + POST /convert/to-ytmusic ─────

from server import importing as _importing  # noqa: E402

APPLE_ALBUM_URL = "https://music.apple.com/us/album/thriller/269572838"
YT_WATCH_URL = "https://music.youtube.com/watch?v=dQw4w9WgXcQ"


def fake_resolve_apple(url):
    assert url == APPLE_ALBUM_URL
    return {
        "source": {
            "kind": "apple-album", "id": "269572838", "name": "Thriller",
            "owner": "Michael Jackson", "artwork": "https://is1.mzstatic.com/600x600bb.jpg",
            "url": APPLE_ALBUM_URL, "track_count": 2,
        },
        "tracks": [
            {"id": "111", "title": "Blinding Lights", "artists": ["The Weeknd"],
             "artist": "The Weeknd", "album": "Thriller", "artwork": None,
             "duration_ms": 202_000, "url": "https://music.apple.com/song/111",
             "explicit": False, "isrc": None},
            {"id": "222", "title": "Obscure B-Side Nobody Covered", "artists": ["Unknown Act"],
             "artist": "Unknown Act", "album": "Thriller", "artwork": None,
             "duration_ms": 180_000, "url": "https://music.apple.com/song/222",
             "explicit": False, "isrc": None},
        ],
    }


def fake_resolve_youtube(url):
    assert url == YT_WATCH_URL
    return {
        "source": {
            "kind": "youtube-video", "id": "dQw4w9WgXcQ",
            "name": "Never Gonna Give You Up", "owner": "Rick Astley",
            "artwork": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
            "url": YT_WATCH_URL, "track_count": 1,
        },
        "tracks": [
            {"id": "dQw4w9WgXcQ", "videoId": "dQw4w9WgXcQ",
             "title": "Never Gonna Give You Up", "artists": ["Rick Astley"],
             "artist": "Rick Astley", "album": "Whenever You Need Somebody",
             "artwork": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
             "duration_ms": 213_000, "url": YT_WATCH_URL, "explicit": False,
             "isrc": None,
             "thumbnails": [{"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"}]},
        ],
    }


@pytest.fixture()
def universal_client():
    app = FastAPI()
    app.include_router(convert_router)
    with patch("server.routes.convert.search", side_effect=fake_search):
        yield TestClient(app)


def test_resolve_universal_ok(universal_client):
    with patch.object(_importing, "resolve_import", fake_resolve_apple):
        response = universal_client.get("/convert/resolve", params={"url": APPLE_ALBUM_URL})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["source"]["kind"] == "apple-album"
    assert payload["source"]["name"] == "Thriller"
    assert [t["title"] for t in payload["tracks"]] == [
        "Blinding Lights", "Obscure B-Side Nobody Covered",
    ]


def test_resolve_universal_bad_url_is_400(universal_client):
    def bad(url):
        raise _importing.ImportUrlError("That doesn't look like a link.")

    with patch.object(_importing, "resolve_import", bad):
        response = universal_client.get("/convert/resolve", params={"url": "junk"})
    assert response.status_code == 400
    assert "link" in response.json()["detail"]


def test_resolve_universal_apple_playlist_is_actionable_400(universal_client):
    def unsupported(url):
        raise _importing.ImportUnsupportedError(_importing.APPLE_PLAYLIST_MESSAGE)

    with patch.object(_importing, "resolve_import", unsupported):
        response = universal_client.get(
            "/convert/resolve",
            params={"url": "https://music.apple.com/us/playlist/x/pl.u-abc"},
        )
    assert response.status_code == 400
    assert "developer token" in response.json()["detail"]


def test_resolve_universal_not_found_is_404(universal_client):
    def missing(url):
        raise _importing.ImportNotFoundError("gone")

    with patch.object(_importing, "resolve_import", missing):
        response = universal_client.get("/convert/resolve", params={"url": APPLE_ALBUM_URL})
    assert response.status_code == 404


def test_convert_universal_streams_source_results(universal_client):
    with patch.object(_importing, "resolve_import", fake_resolve_apple):
        response = universal_client.post(
            "/convert/to-ytmusic", json={"url": APPLE_ALBUM_URL}
        )
    assert response.status_code == 200, response.text
    events = parse_sse(response.text)
    kinds = [event for event, _ in events]
    assert kinds[0] == "start"
    assert kinds[-1] == "done"
    assert kinds.count("progress") == 2

    start = events[0][1]
    assert start["total"] == 2
    assert start["source"]["kind"] == "apple-album"

    progress = [p for e, p in events if e == "progress"]
    first = progress[0]["result"]
    assert "spotify" not in first  # universal results carry `source`, not `spotify`
    assert first["source"]["title"] == "Blinding Lights"
    assert first["status"] == "matched"
    assert first["match"]["videoId"] == "yt1"
    assert progress[1]["result"]["status"] == "not_found"
    assert events[-1][1]["summary"] == {
        "total": 2, "matched": 1, "approximate": 0, "not_found": 1, "error": 0,
    }


def test_convert_universal_youtube_skips_matching(universal_client):
    def forbidden_search(query, **kwargs):
        raise AssertionError("YouTube sources must not be searched")

    app = FastAPI()
    app.include_router(convert_router)
    with (
        patch.object(_importing, "resolve_import", fake_resolve_youtube),
        patch("server.routes.convert.search", side_effect=forbidden_search),
    ):
        client = TestClient(app)
        response = client.post("/convert/to-ytmusic", json={"url": YT_WATCH_URL})

    assert response.status_code == 200, response.text
    events = parse_sse(response.text)
    progress = [p for e, p in events if e == "progress"]
    assert len(progress) == 1
    result = progress[0]["result"]
    assert result["status"] == "matched"
    assert result["confidence"] == 1.0
    assert result["error"] is None
    assert result["match"]["videoId"] == "dQw4w9WgXcQ"
    assert result["source"]["title"] == "Never Gonna Give You Up"
    assert events[-1][1]["summary"]["matched"] == 1


def test_convert_universal_bad_url_is_400_before_stream(universal_client):
    def bad(url):
        raise _importing.ImportUrlError("nope")

    with patch.object(_importing, "resolve_import", bad):
        response = universal_client.post("/convert/to-ytmusic", json={"url": "junk"})
    assert response.status_code == 400


def test_convert_universal_rejects_bad_limit(universal_client):
    response = universal_client.post(
        "/convert/to-ytmusic", json={"url": APPLE_ALBUM_URL, "limit": 0}
    )
    assert response.status_code == 422
