"""Tests for server/share_store.py + server/routes/shares.py — playlist sharing."""

import json
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server import share_store
from server.routes.shares import router as shares_router

CODE_RE = re.compile(r"^pl_[A-Za-z0-9]{12}$")


def make_payload(**overrides) -> dict:
    payload = {
        "name": "Road Trip Mix",
        "description": "songs for the drive",
        "artwork": "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
        "tracks": [
            {
                "videoId": "abc123",
                "title": "Blinding Lights",
                "artists": ["The Weeknd"],
                "artist": "The Weeknd",
                "album": "After Hours",
                "duration": "3:22",
                "durationSeconds": 202,
                "artwork": "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
                "year": 2020,
                "isExplicit": False,
            },
            {"videoId": "def456", "title": "Levitating", "artist": "Dua Lipa"},
        ],
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def store_file(tmp_path, monkeypatch):
    path = tmp_path / "nested" / "shared_playlists.json"
    monkeypatch.setenv("CARMEN_SHARE_STORE", str(path))
    return path


@pytest.fixture()
def client(store_file):
    app = FastAPI()
    app.include_router(shares_router)
    return TestClient(app)


# ── HTTP round-trip ───────────────────────────────────────────────────────


def test_create_then_get_round_trip(client):
    response = client.post("/share/playlists", json=make_payload())
    assert response.status_code == 200, response.text
    code = response.json()["code"]
    assert CODE_RE.match(code)

    response = client.get(f"/share/playlists/{code}")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["code"] == code
    assert payload["name"] == "Road Trip Mix"
    assert payload["description"] == "songs for the drive"
    assert payload["artwork"].endswith("maxresdefault.jpg")
    assert payload["sharedAt"]  # ISO stamp present
    assert [t["videoId"] for t in payload["tracks"]] == ["abc123", "def456"]
    first = payload["tracks"][0]
    assert first["title"] == "Blinding Lights"
    assert first["artists"] == ["The Weeknd"]
    assert first["durationSeconds"] == 202
    assert first["year"] == 2020
    assert first["isExplicit"] is False


def test_unknown_code_is_404(client):
    response = client.get("/share/playlists/pl_zzzzzzzzzzzz")
    assert response.status_code == 404
    assert response.json()["detail"]


def test_repost_same_code_updates_in_place(client, store_file):
    code = client.post("/share/playlists", json=make_payload()).json()["code"]
    first = client.get(f"/share/playlists/{code}").json()

    updated = make_payload(name="Renamed Mix", tracks=[{"videoId": "x1", "title": "Only Song"}])
    updated["code"] = code
    response = client.post("/share/playlists", json=updated)
    assert response.status_code == 200, response.text
    assert response.json()["code"] == code  # the link is stable

    payload = client.get(f"/share/playlists/{code}").json()
    assert payload["name"] == "Renamed Mix"
    assert [t["videoId"] for t in payload["tracks"]] == ["x1"]
    assert payload["sharedAt"] >= first["sharedAt"]  # refreshed on update

    on_disk = json.loads(store_file.read_text())
    assert list(on_disk) == [code]  # updated in place, not duplicated


def test_invalid_code_is_rejected(client):
    for bad in ("nope", "pl_short", "pl_has-dash-here", "xx_abcdefghijkl", ""):
        payload = make_payload()
        if bad == "":
            continue  # empty string is a *missing* name/code edge, covered below
        payload["code"] = bad
        response = client.post("/share/playlists", json=payload)
        assert response.status_code in (400, 422), (bad, response.text)


def test_oversized_track_list_is_rejected(client):
    tracks = [{"videoId": f"v{i}", "title": f"Song {i}"} for i in range(501)]
    response = client.post("/share/playlists", json=make_payload(tracks=tracks))
    assert response.status_code == 422


def test_max_track_list_is_accepted(client):
    tracks = [{"videoId": f"v{i}", "title": f"Song {i}"} for i in range(500)]
    response = client.post("/share/playlists", json=make_payload(tracks=tracks))
    assert response.status_code == 200, response.text


def test_name_validation(client):
    assert client.post("/share/playlists", json=make_payload(name="")).status_code == 422
    assert (
        client.post("/share/playlists", json=make_payload(name="x" * 201)).status_code
        == 422
    )
    assert (
        client.post("/share/playlists", json=make_payload(name="x" * 200)).status_code
        == 200
    )


def test_track_requires_video_id_and_title(client):
    payload = make_payload(tracks=[{"title": "No ID"}])
    assert client.post("/share/playlists", json=payload).status_code == 422
    payload = make_payload(tracks=[{"videoId": "v1"}])
    assert client.post("/share/playlists", json=payload).status_code == 422


# ── store unit tests ──────────────────────────────────────────────────────


def test_store_generates_codes_and_persists(store_file):
    code = share_store.create_or_update(None, {"name": "A", "tracks": []})
    assert CODE_RE.match(code)
    assert store_file.exists()  # directory + file created on demand
    stored = share_store.get(code)
    assert stored["name"] == "A"
    assert stored["code"] == code
    assert stored["sharedAt"].endswith("Z")


def test_store_supplied_code_round_trip(store_file):
    code = share_store.create_or_update("pl_abcdefgh1234", {"name": "B", "tracks": []})
    assert code == "pl_abcdefgh1234"
    share_store.create_or_update(code, {"name": "B2", "tracks": []})
    assert share_store.get(code)["name"] == "B2"


@pytest.mark.parametrize("bad", ["nope", "pl_short", "pl_waytoolong" + "x" * 30, "pl_bad-dash", 42])
def test_store_invalid_code_raises(store_file, bad):
    with pytest.raises(ValueError):
        share_store.create_or_update(bad, {"name": "X"})


def test_store_get_unknown_returns_none(store_file):
    assert share_store.get("pl_zzzzzzzzzzzz") is None
    assert share_store.get("") is None
