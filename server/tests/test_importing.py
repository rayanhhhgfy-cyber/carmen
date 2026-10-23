"""Tests for server/importing.py — classification + resolvers, and the
Spotify album/track/artist support in spotify.py + spotify_scrape.py."""

import json

import httpx
import pytest

from server import importing
from server.importing import (
    ImportNotFoundError,
    ImportUnsupportedError,
    ImportUpstreamError,
    ImportUrlError,
    classify_import_url,
    resolve_import,
)
from server.spotify import SpotifyClient, SpotifyPlaylist, SpotifyTrack
from server.spotify_scrape import ScrapedSpotifyClient, parse_embed_entity

SPOTIFY_ID = "37i9dQZF1DXcBWIGoYBM5M"
ALBUM_ID = "4aawyAB9vmqN3uQ7FjRGTy"
TRACK_ID = "7ouMYWpwJ422jRcDASZB7P"
ARTIST_ID = "0OdUWJ0sBjDrqHygGUXeCF"
YT_VIDEO_ID = "dQw4w9WgXcQ"
YT_PLAYLIST_ID = "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"

TOKEN_OK = {"access_token": "tok_123", "token_type": "Bearer", "expires_in": 3600}


# ── classification ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw, expected",
    [
        # Spotify — URLs, URIs, bare ids
        (f"https://open.spotify.com/playlist/{SPOTIFY_ID}", ("spotify-playlist", SPOTIFY_ID)),
        (f"https://open.spotify.com/playlist/{SPOTIFY_ID}?si=abc", ("spotify-playlist", SPOTIFY_ID)),
        (f"https://open.spotify.com/intl-de/album/{ALBUM_ID}?si=x", ("spotify-album", ALBUM_ID)),
        (f"https://open.spotify.com/track/{TRACK_ID}", ("spotify-track", TRACK_ID)),
        (f"https://open.spotify.com/artist/{ARTIST_ID}", ("spotify-artist", ARTIST_ID)),
        (f"spotify:playlist:{SPOTIFY_ID}", ("spotify-playlist", SPOTIFY_ID)),
        (f"spotify:album:{ALBUM_ID}", ("spotify-album", ALBUM_ID)),
        (f"spotify:track:{TRACK_ID}", ("spotify-track", TRACK_ID)),
        (f"spotify:artist:{ARTIST_ID}", ("spotify-artist", ARTIST_ID)),
        (SPOTIFY_ID, ("spotify-playlist", SPOTIFY_ID)),  # bare id → playlist
        (f"  https://open.spotify.com/track/{TRACK_ID}  ", ("spotify-track", TRACK_ID)),
        # Apple Music
        ("https://music.apple.com/us/album/thriller/269572838", ("apple-album", "269572838")),
        ("https://music.apple.com/gb/album/some-album-name/123456789?i=987654321", ("apple-album", "123456789")),
        ("https://music.apple.com/us/album/123456789", ("apple-album", "123456789")),
        ("https://music.apple.com/us/playlist/my-mix/pl.u-abcXYZ123", ("apple-playlist", "pl.u-abcXYZ123")),
        ("https://music.apple.com/us/playlist/pl.D9931a2b", ("apple-playlist", "pl.D9931a2b")),
        ("pl.u-abcXYZ123", ("apple-playlist", "pl.u-abcXYZ123")),
        # YouTube / YouTube Music
        (f"https://music.youtube.com/watch?v={YT_VIDEO_ID}", ("youtube-video", YT_VIDEO_ID)),
        (f"https://www.youtube.com/watch?v={YT_VIDEO_ID}", ("youtube-video", YT_VIDEO_ID)),
        (f"https://youtube.com/watch?v={YT_VIDEO_ID}&list={YT_PLAYLIST_ID}", ("youtube-video", YT_VIDEO_ID)),
        (f"https://music.youtube.com/watch?v={YT_VIDEO_ID}&list={YT_PLAYLIST_ID}", ("youtube-video", YT_VIDEO_ID)),
        (f"https://youtu.be/{YT_VIDEO_ID}", ("youtube-video", YT_VIDEO_ID)),
        (f"https://youtu.be/{YT_VIDEO_ID}?si=xyz", ("youtube-video", YT_VIDEO_ID)),
        (f"https://music.youtube.com/playlist?list={YT_PLAYLIST_ID}", ("youtube-playlist", YT_PLAYLIST_ID)),
        (f"https://www.youtube.com/playlist?list={YT_PLAYLIST_ID}", ("youtube-playlist", YT_PLAYLIST_ID)),
        (YT_VIDEO_ID, ("youtube-video", YT_VIDEO_ID)),
        (YT_PLAYLIST_ID, ("youtube-playlist", YT_PLAYLIST_ID)),
    ],
)
def test_classify_accepts(raw, expected):
    assert classify_import_url(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "not a link",
        "https://example.com/playlist/abc",
        "https://open.spotify.com/track/short",
        f"spotify:track:short",
        "https://music.apple.com/us/artist/someone/123456",
        "https://youtube.com/watch?v=short",
        "https://youtube.com/playlist",  # no list param
        "https://vimeo.com/123456789",
    ],
)
def test_classify_rejects(raw):
    with pytest.raises(ImportUrlError):
        classify_import_url(raw)


# ── Apple Music ───────────────────────────────────────────────────────────


def test_apple_playlist_resolve_is_actionable_error():
    with pytest.raises(ImportUnsupportedError) as excinfo:
        resolve_import("https://music.apple.com/us/playlist/my-mix/pl.u-abcXYZ123")
    message = str(excinfo.value)
    assert "developer token" in message
    assert "album" in message  # suggests the working alternative


def _itunes_payload() -> dict:
    return {
        "resultCount": 4,
        "results": [
            {
                "wrapperType": "collection",
                "collectionId": 269572838,
                "collectionName": "Thriller",
                "artistName": "Michael Jackson",
                "artworkUrl100": "https://is1.mzstatic.com/image/100x100bb.jpg",
                "collectionViewUrl": "https://music.apple.com/us/album/thriller/269572838",
            },
            {
                "wrapperType": "track",
                "trackId": 269573364,
                "trackName": "Billie Jean",
                "artistName": "Michael Jackson",
                "collectionName": "Thriller",
                "artworkUrl100": "https://is1.mzstatic.com/image/100x100bb.jpg",
                "trackTimeMillis": 294826,
                "trackViewUrl": "https://music.apple.com/us/song/billie-jean/269573364",
                "trackExplicitness": "notExplicit",
            },
            {"wrapperType": "artist", "artistId": 32940, "artistName": "Michael Jackson"},
            {
                "wrapperType": "track",
                "trackId": 269573368,
                "trackName": "Beat It",
                "artistName": "Michael Jackson",
                "collectionName": "Thriller",
                "artworkUrl100": "https://is1.mzstatic.com/image/100x100bb.jpg",
                "trackTimeMillis": 258895,
                "trackViewUrl": "https://music.apple.com/us/song/beat-it/269573368",
                "trackExplicitness": "explicit",
            },
        ],
    }


def test_apple_album_resolver_with_stubbed_http(monkeypatch):
    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append((url, params))
        return httpx.Response(200, json=_itunes_payload())

    monkeypatch.setattr(importing.httpx, "get", fake_get)
    resolved = resolve_import("https://music.apple.com/us/album/thriller/269572838")

    assert calls[0][0] == "https://itunes.apple.com/lookup"
    assert calls[0][1] == {"id": "269572838", "entity": "song"}

    source = resolved["source"]
    assert source["kind"] == "apple-album"
    assert source["id"] == "269572838"
    assert source["name"] == "Thriller"
    assert source["owner"] == "Michael Jackson"
    assert "600x600bb" in source["artwork"]  # upgraded from 100x100bb
    assert source["track_count"] == 2

    tracks = resolved["tracks"]
    assert [t["title"] for t in tracks] == ["Billie Jean", "Beat It"]
    first = tracks[0]
    assert first["id"] == "269573364"
    assert first["artists"] == ["Michael Jackson"]
    assert first["artist"] == "Michael Jackson"
    assert first["album"] == "Thriller"
    assert first["duration_ms"] == 294826
    assert first["explicit"] is False
    assert tracks[1]["explicit"] is True
    assert "600x600bb" in first["artwork"]


def test_apple_album_not_found(monkeypatch):
    monkeypatch.setattr(
        importing.httpx, "get", lambda *a, **k: httpx.Response(200, json={"results": []})
    )
    with pytest.raises(ImportNotFoundError):
        importing.resolve_apple_album("999999999")


def test_apple_album_upstream_failure(monkeypatch):
    monkeypatch.setattr(
        importing.httpx, "get", lambda *a, **k: httpx.Response(500, text="boom")
    )
    with pytest.raises(ImportUpstreamError):
        importing.resolve_apple_album("269572838")

    def boom(*a, **k):
        raise httpx.ConnectError("dns down")

    monkeypatch.setattr(importing.httpx, "get", boom)
    with pytest.raises(ImportUpstreamError):
        importing.resolve_apple_album("269572838")


# ── YouTube resolvers (core monkeypatched) ────────────────────────────────


def _fake_playlist(playlist_id, limit):
    assert playlist_id == YT_PLAYLIST_ID
    return {
        "title": "YT Mix",
        "author": {"name": "Curator"},
        "trackCount": 2,
        "thumbnails": [
            {"url": "https://i.ytimg.com/small.jpg", "width": 120, "height": 90},
            {"url": "https://i.ytimg.com/big.jpg", "width": 1280, "height": 720},
        ],
        "tracks": [
            {
                "videoId": YT_VIDEO_ID,
                "title": "Song A",
                "artists": [{"name": "Artist A"}],
                "album": {"name": "Album A"},
                "duration": "3:22",
                "duration_seconds": 202,
                "thumbnails": [{"url": "https://i.ytimg.com/a.jpg", "width": 640, "height": 480}],
                "isExplicit": True,
            },
            {
                "videoId": "abc123XYZ09",
                "title": "Song B",
                "artists": [{"name": "Artist B"}],
                "album": "Album B",
                "duration": "2:05",
                "thumbnails": [],
            },
        ],
    }


def _fake_track(video_id, provider):
    assert video_id == YT_VIDEO_ID
    assert provider is None
    return {
        "videoId": YT_VIDEO_ID,
        "title": "Never Gonna Give You Up",
        "artists": [{"name": "Rick Astley"}],
        "album": {"name": "Whenever You Need Somebody"},
        "duration": "3:33",
        "duration_seconds": 213,
        "artwork": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
        "thumbnails": [{"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", "width": 1280, "height": 720}],
        "isExplicit": False,
    }


def test_youtube_playlist_resolver(monkeypatch):
    monkeypatch.setattr(importing.core, "get_playlist", _fake_playlist)
    resolved = resolve_import(f"https://music.youtube.com/playlist?list={YT_PLAYLIST_ID}")

    source = resolved["source"]
    assert source["kind"] == "youtube-playlist"
    assert source["name"] == "YT Mix"
    assert source["owner"] == "Curator"
    assert source["artwork"] == "https://i.ytimg.com/big.jpg"
    assert source["track_count"] == 2

    first, second = resolved["tracks"]
    assert first["id"] == YT_VIDEO_ID
    assert first["videoId"] == YT_VIDEO_ID  # ready to emit as a YTM match
    assert first["artists"] == ["Artist A"]
    assert first["album"] == "Album A"
    assert first["duration_ms"] == 202_000
    assert first["explicit"] is True
    assert second["duration_ms"] == 125_000  # parsed from "2:05"
    assert second["album"] == "Album B"


def test_youtube_video_resolver(monkeypatch):
    monkeypatch.setattr(importing.core, "get_track", _fake_track)
    resolved = resolve_import(f"https://youtu.be/{YT_VIDEO_ID}")

    source = resolved["source"]
    assert source["kind"] == "youtube-video"
    assert source["name"] == "Never Gonna Give You Up"
    assert source["owner"] == "Rick Astley"
    assert source["track_count"] == 1

    (track,) = resolved["tracks"]
    assert track["id"] == YT_VIDEO_ID
    assert track["duration_ms"] == 213_000
    assert track["url"] == f"https://music.youtube.com/watch?v={YT_VIDEO_ID}"


def test_youtube_playlist_not_found(monkeypatch):
    monkeypatch.setattr(importing.core, "get_playlist", lambda pid, limit: None)
    with pytest.raises(ImportNotFoundError):
        importing.resolve_youtube_playlist(YT_PLAYLIST_ID)


# ── Spotify resolver (common-shape mapping via a fake client) ─────────────


class FakeSpotifyContainerClient:
    def get_album(self, album_id):
        assert album_id == ALBUM_ID
        return SpotifyPlaylist(
            id=ALBUM_ID,
            name="Fake Album",
            owner="Fake Artist",
            artwork="https://i.scdn.co/cover",
            spotify_url=f"https://open.spotify.com/album/{ALBUM_ID}",
            tracks=[
                SpotifyTrack(
                    id=TRACK_ID, title="Fake Song", artists=["Fake Artist"],
                    album="Fake Album", album_artwork="https://i.scdn.co/cover",
                    duration_ms=210_000, isrc="USFAKE000001",
                    spotify_url=f"https://open.spotify.com/track/{TRACK_ID}",
                    explicit=True,
                ),
                SpotifyTrack(id="t2", title="No Album Song", artists=["Fake Artist"]),
            ],
        )

    def close(self):
        pass


def test_spotify_resolver_maps_common_shape(monkeypatch):
    monkeypatch.setattr(importing, "spotify_configured", lambda: True)
    monkeypatch.setattr(importing, "SpotifyClient", FakeSpotifyContainerClient)
    resolved = resolve_import(f"https://open.spotify.com/album/{ALBUM_ID}")

    source = resolved["source"]
    assert source == {
        "kind": "spotify-album",
        "id": ALBUM_ID,
        "name": "Fake Album",
        "owner": "Fake Artist",
        "artwork": "https://i.scdn.co/cover",
        "url": f"https://open.spotify.com/album/{ALBUM_ID}",
        "track_count": 2,
    }
    first, second = resolved["tracks"]
    assert first["artists"] == ["Fake Artist"]
    assert first["artist"] == "Fake Artist"
    assert first["duration_ms"] == 210_000
    assert first["isrc"] == "USFAKE000001"
    assert first["explicit"] is True
    assert second["album"] is None  # empty album name → None
    assert second["duration_ms"] is None  # unknown duration → None


# ── Spotify official client: album / track / artist ───────────────────────


def make_official_client(handler):
    transport = httpx.MockTransport(handler)
    return SpotifyClient(client_id="cid", client_secret="csecret", http=httpx.Client(transport=transport))


def token_then(handler):
    def wrapped(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/token":
            return httpx.Response(200, json=TOKEN_OK)
        return handler(request)

    return wrapped


def _full_track(track_id, name, artists=("Artist A",), **overrides):
    track = {
        "id": track_id,
        "name": name,
        "artists": [{"name": a} for a in artists],
        "album": {
            "name": "The Album",
            "images": [{"url": "https://i.scdn.co/album", "height": 640, "width": 640}],
        },
        "duration_ms": 200_000,
        "explicit": False,
        "external_ids": {"isrc": "US-AAA-00-00001"},
        "external_urls": {"spotify": f"https://open.spotify.com/track/{track_id}"},
    }
    track.update(overrides)
    return track


def test_official_client_get_album_paginates():
    simplified = [
        {"id": "s1", "name": "First", "artists": [{"name": "Artist A"}],
         "duration_ms": 111_000, "explicit": False,
         "external_urls": {"spotify": "https://open.spotify.com/track/s1"}},
        {"id": "s2", "name": "Second", "artists": [{"name": "Artist A"}],
         "duration_ms": 112_000, "explicit": True,
         "external_urls": {"spotify": "https://open.spotify.com/track/s2"}},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == f"/v1/albums/{ALBUM_ID}":
            return httpx.Response(200, json={
                "id": ALBUM_ID, "name": "The Album",
                "artists": [{"name": "Artist A"}],
                "images": [{"url": "https://i.scdn.co/album", "height": 640, "width": 640}],
                "external_urls": {"spotify": f"https://open.spotify.com/album/{ALBUM_ID}"},
                "tracks": {"items": simplified[:1], "next": "page2"},
            })
        if request.url.path == f"/v1/albums/{ALBUM_ID}/tracks":
            return httpx.Response(200, json={"items": simplified[1:], "next": None})
        raise AssertionError(f"unexpected {request.url}")

    client = make_official_client(token_then(handler))
    album = client.get_album(ALBUM_ID)
    assert album.name == "The Album"
    assert album.owner == "Artist A"
    assert album.artwork == "https://i.scdn.co/album"
    assert [t.id for t in album.tracks] == ["s1", "s2"]
    # Simplified album tracks inherit the album name + cover.
    assert album.tracks[0].album == "The Album"
    assert album.tracks[0].album_artwork == "https://i.scdn.co/album"
    assert album.tracks[1].explicit is True


def test_official_client_get_track():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/v1/tracks/{TRACK_ID}"
        return httpx.Response(200, json=_full_track(TRACK_ID, "One Song", ("Solo Artist",)))

    client = make_official_client(token_then(handler))
    container = client.get_track(TRACK_ID)
    assert container.name == "One Song"
    assert container.owner == "Solo Artist"
    assert container.track_count == 1
    assert container.tracks[0].isrc == "US-AAA-00-00001"


def test_official_client_get_artist_top_tracks():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == f"/v1/artists/{ARTIST_ID}":
            return httpx.Response(200, json={
                "id": ARTIST_ID, "name": "Top Artist",
                "images": [{"url": "https://i.scdn.co/artist", "height": 640, "width": 640}],
                "external_urls": {"spotify": f"https://open.spotify.com/artist/{ARTIST_ID}"},
            })
        if request.url.path == f"/v1/artists/{ARTIST_ID}/top-tracks":
            return httpx.Response(200, json={"tracks": [_full_track("top1", "Big Hit")]})
        raise AssertionError(f"unexpected {request.url}")

    client = make_official_client(token_then(handler))
    container = client.get_artist(ARTIST_ID)
    assert container.name == "Top Artist"
    assert container.artwork == "https://i.scdn.co/artist"
    assert [t.title for t in container.tracks] == ["Big Hit"]


# ── Spotify scrape parser: album / track / artist shapes ──────────────────


def _embed_html(entity: dict) -> str:
    payload = {"props": {"pageProps": {"state": {"data": {"entity": entity}}}}}
    return (
        "<html><head>"
        f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(payload)}</script>'
        "</head><body></body></html>"
    )


def _embed_track(uri_suffix, title, artist, duration_ms=200_000, explicit=False):
    return {
        "uri": f"spotify:track:{uri_suffix}",
        "title": title,
        "subtitle": artist,
        "duration": duration_ms,
        "isExplicit": explicit,
        "entityType": "track",
    }


def test_scrape_album_from_tracklist():
    entity = {
        "title": "Embed Album",
        "subtitle": "Embed Artist",
        "coverArt": {"sources": [{"url": "https://i.scdn.co/cover"}]},
        "trackList": [_embed_track("a1", "Album Song", "Embed Artist")],
    }
    album = parse_embed_entity(_embed_html(entity), "album", ALBUM_ID)
    assert album.name == "Embed Album"
    assert album.spotify_url == f"https://open.spotify.com/album/{ALBUM_ID}"
    (track,) = album.tracks
    assert track.title == "Album Song"
    assert track.album == "Embed Album"  # fallback: the album's own name
    assert track.album_artwork == "https://i.scdn.co/cover"


def test_scrape_album_from_tracks_items():
    entity = {
        "title": "Items Album",
        "subtitle": "Items Artist",
        "tracks": {
            "items": [
                _full_track("i1", "Items Song", ("Items Artist",)),
                {"track": _full_track("i2", "Wrapped Song", ("Items Artist",))},
            ]
        },
    }
    album = parse_embed_entity(_embed_html(entity), "album", ALBUM_ID)
    assert [t.id for t in album.tracks] == ["i1", "i2"]
    assert album.tracks[0].artists == ["Items Artist"]
    assert album.tracks[0].album == "The Album"  # from the track's own album


def test_scrape_single_track_entity():
    entity = {
        "title": "Lone Song",
        "subtitle": "Lone Artist",
        "uri": f"spotify:track:{TRACK_ID}",
        "duration": 187_000,
        "isExplicit": True,
        "coverArt": {"sources": [{"url": "https://i.scdn.co/single"}]},
    }
    container = parse_embed_entity(_embed_html(entity), "track", TRACK_ID)
    assert container.name == "Lone Song"
    assert container.owner == "Lone Artist"
    (track,) = container.tracks
    assert track.id == TRACK_ID
    assert track.duration_ms == 187_000
    assert track.explicit is True
    assert track.album_artwork == "https://i.scdn.co/single"


def test_scrape_artist_from_tracklist():
    entity = {
        "title": "Embed Artist",
        "coverArt": {"sources": [{"url": "https://i.scdn.co/artist"}]},
        "trackList": [
            _embed_track("top1", "Hit One", "Embed Artist"),
            _embed_track("top2", "Hit Two", "Embed Artist"),
        ],
    }
    container = parse_embed_entity(_embed_html(entity), "artist", ARTIST_ID)
    assert container.name == "Embed Artist"
    assert container.artwork == "https://i.scdn.co/artist"
    assert [t.title for t in container.tracks] == ["Hit One", "Hit Two"]


def test_scrape_client_get_album_uses_embed_url():
    entity = {
        "title": "Client Album",
        "subtitle": "Client Artist",
        "trackList": [_embed_track("c1", "Client Song", "Client Artist")],
    }
    html = _embed_html(entity)

    def handler(request: httpx.Request) -> httpx.Response:
        assert f"embed/album/{ALBUM_ID}" in str(request.url)
        return httpx.Response(200, text=html)

    client = ScrapedSpotifyClient(http=httpx.Client(transport=httpx.MockTransport(handler)))
    try:
        album = client.get_album(ALBUM_ID)
    finally:
        client.close()
    assert album.name == "Client Album"
    assert album.track_count == 1
