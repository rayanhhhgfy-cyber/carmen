# Carmen — Feature Port Log

Port commissioned by Rayyan, 2026-10-23: items 3 (shareable playlists), 5 (universal
import), 6 (local file playback), download-whole-playlist, 7 (library backup/restore),
8 (drag reorder). Nothing outside these six items may change. No push, no deploy —
delivery is the main agent's step.

## Baselines (recorded BEFORE any change, 2026-10-23)

| Check | Baseline |
|---|---|
| Frontend `npm run typecheck` | PASS (0 errors) |
| Frontend vitest | **28 passed** (2 files: `db/repos/playlists.fallback.test.ts` 7, `services/spotifyConvert.test.ts` 21) |
| Frontend production build (`npm --prefix frontend run build`) | PASS (~15 s) |
| Server pytest (`server/tests`) | **75 passed** (test_convert_routes, test_matching, test_spotify, test_spotify_scrape) |
| Server module import check | All modules import clean: `server.__main__`, core, share, spotify, spotify_scrape, cache, sanitizers, matching, all routes |

Environment notes: this machine has Python 3.12.3 only (no 3.11); a project venv was
created at `~/workspace/carmen/venv` from `server/requirements.txt` + pytest, and all
deps import. The Telegram library installs as **pyrogram** (kurigram fork, pinned zip in
requirements.txt) — imported by `server/__main__.py` and used in `server/routes/stream.py`.

Pre-existing working-tree touches (main agent's Vercel deploy step — left alone):
modified `.gitignore`, untracked `frontend/.gitignore`.

## Architecture facts the port builds on

- `server/share.py` is an OG-preview renderer only (query-string song/search/playlist
  links → meta tags). There is NO existing share registry — item 1 adds one.
- Server routes are aggregated in `server/routes/__init__.py`; the SPA catch-all
  (`app_router`) is included LAST on purpose — new routers go before it.
- Route house style: `@sanitized` over `@cached(prefix, ttl=…, id_arg=…)`; blocking
  ytmusicapi calls run on the shared executor in `server/state.py`.
- Frontend uses HashRouter: the share code therefore travels in a **query parameter**
  (`?pl=CODE`) read at boot, never in the hash.
- Playlists repo already exposes `moveTrackInPlaylist(playlistId, videoId, toPosition)`
  on both backends — item 8's playlist half is UI-only.
- Queue order persists automatically: `player/persistence.ts` snapshots on structural
  queue changes — a `reorderQueue` state op is enough.
- Playback source ladder (`offline/source.ts`): local asset → local blob (IndexedDB)
  → stream URL. Anything registered as a download record plays through it unchanged.
- `@tanstack/react-virtual` is used ONLY by `components/SyncedLyrics.tsx` — queue and
  playlist lists are not virtualized, so drag reorder cannot corrupt a virtual window.
- Downloads: `utils/downloads.ts` `startDownload()` is idempotent and fire-and-forget;
  job state lives in `utils/downloadsStore.ts` (`useDownloads()` hook) — item "download
  all" is a loop over that pipeline, not a new system.

## Per-item design decisions

### Item 1 — Shareable playlists (server registry + client)
- New `server/share_store.py`: JSON-file registry (thread lock, atomic tmp+replace
  writes). Path from env `CARMEN_SHARE_STORE`, default `server/data/shared_playlists.json`
  (created on demand). Mirrors the reference app's `data/shared_playlists.json` approach.
- Codes: `pl_` + 12 base62 chars (`secrets`). A client may re-POST with its existing
  code to update the shared copy in place → the link is stable per playlist. The
  frontend remembers code per playlist id in the app-state store.
- New `server/routes/shares.py`: `POST /share/playlists` (create/update),
  `GET /share/playlists/{code}` (resolve, 404 unknown). Pydantic validation, 500-track cap.
- Frontend `services/playlistShare.ts`: build/parse share URL (`?pl=`), create/resolve,
  import (create playlist + add tracks through the normal repos).
- Share dialog on the playlist detail view: link + copy, code, QR code (new `qrcode`
  dependency — explicitly allowed), and `navigator.share` with clipboard fallback.
  NOTE: `utils/share.ts` documents "sharing always copies the link — no system share
  sheet" for *song* shares; the locked scope explicitly requires the native sheet for
  *playlist* shares, so playlists deliberately diverge (songs untouched).
- Boot gate: a component mounted in `App.tsx` reads `?pl=` once at startup, strips the
  parameter, resolves the code and asks "Import this playlist?" before saving a copy.
  Manual import by pasting a link/code is handled by the generalised import dialog.

### Item 5 — Universal import
- New `server/importing.py`: URL classification (Spotify playlist/album/track/artist,
  Apple Music album/playlist, YouTube/YTM video/playlist) + resolvers producing one
  common source shape. Spotify entities go through the official client when configured,
  else the embed scraper (parser generalised from playlist-only to album/track/artist).
  Apple albums resolve through the public iTunes Lookup API (`lookup?id=…&entity=song`),
  the same public endpoint family the client already uses. YouTube sources resolve via
  `core.get_playlist` / `core.get_track`; in conversion they are already YouTube Music
  items, so they are emitted as matched with confidence 1.0 (no search matching).
- **Apple Music playlists (`pl.…` ids) cannot be resolved**: Apple's public APIs expose
  no playlist contents without a paid developer token, and the reference app has the
  same limit. Playlist links are classified and rejected with a precise, actionable
  error instead of failing obscurely.
- New endpoints alongside (not replacing) the Spotify ones:
  `GET /convert/resolve?url=` (preview) and `POST /convert/to-ytmusic` (same SSE
  contract: start → progress per track → done; result field is `source`, not `spotify`).
  The existing `/convert/spotify/*` endpoints are untouched.
- Frontend: `services/spotifyConvert.ts` generalised in place (same file/exports kept
  as wrappers), the existing `SpotifyImportDialog` generalised (source-aware labels,
  optional `initialUrl`), and the Search box offers the import flow when the pasted
  text is a recognised link. A Carmen share link pasted into the dialog imports the
  shared playlist directly (no conversion step).

### Item 6 — Local audio files (web)
- **Decision: persisted, not session-scoped.** Carmen's storage layer already has
  everything needed with ZERO schema change: picked files are written through
  `offline/storage.writeBinary` into the song folder, registered as download records
  (`insertDownload` + `markDownloaded`), and added to a "Local Files" playlist — so
  they play through the existing blob-source ladder and the normal queue, survive
  reloads, and need no PlayerContext changes. Metadata comes from the filename
  (extension stripped), artist "Local file", duration probed best-effort from an
  `<audio>` element. Consequence (accepted, mirrors the single physical store):
  local files also appear in the downloads catalogue, and deleting the offline copy
  deletes the local file.

### Download whole playlist
- "Download all" on the playlist detail view loops the playlist's tracks through the
  existing `startDownload()` (which already skips downloaded/running tracks), and the
  progress shown is aggregated from the existing downloads job store. Per-track
  failures stay isolated in their own jobs — nothing new to fail wholesale.

### Item 7 — Library backup & restore
- `utils/libraryBackup.ts`: dated JSON (`carmen-library-YYYY-MM-DD.json`) containing
  playlists (with ordered track metadata), favorites (track metadata) and the
  downloads index (videoId + metadata + byte size + date — metadata only: the audio
  bytes themselves live in IndexedDB and are far too large to embed in JSON; after a
  restore, downloaded songs re-download on demand / via Download all). Restore runs
  only after an explicit confirm, validates the file shape first, upserts track
  metadata, recreates playlists in order, and re-adds favorites. Round-trip on an
  empty library is lossless for playlists and favorites (pinned by a test).

### Item 8 — Drag reorder
- Pure `moveItem()` helper (+ tests). Pointer-events based drag hook
  (`hooks/useDragReorder.ts`) — works for mouse and touch, no HTML5-drag dependency.
- Queue: `PlayerContext` gains an additive `reorderQueue(from, to)`; both queue UIs
  (now-playing queue sheet and the queue page tab) get drag handles; persistence is
  automatic (see architecture facts).
- Playlists: rows in the playlist detail view get drag handles; the new order is
  applied optimistically and persisted via the existing `moveTrackInPlaylist`.

## Telegram integration — verification scope
No live bot credentials exist in this environment and none were invented or fetched.
Verification is code-level only: the pyrogram client import in `server/__main__.py`,
its wiring into the stream/cache path (`server/routes/stream.py`), the
credentials-absent path ("Telegram credentials not set — skipping TG cache.") exercised
by the credential-free boot smoke, and the test suite staying green. A live bot
round-trip needs Rayyan's own API_ID / API_HASH / BOT_TOKEN / CHAT_ID and was NOT
performed.

## Work log

### Implementation (2026-10-23, four parallel workstreams + coordinator)

Server (items 1 + 5):
- NEW `server/share_store.py`, `server/routes/shares.py` (registered before the SPA
  catch-all in `server/routes/__init__.py`); NEW `server/importing.py`;
  `server/routes/convert.py` gained `/convert/resolve` + `/convert/to-ytmusic`
  additively — the existing `/convert/spotify/*` handlers are byte-identical.
- `server/spotify.py`: `get_album`/`get_track`/`get_artist` added (one shared 404
  message reworded "playlist" → "item"; existing test still passes).
  `server/spotify_scrape.py`: embed parser generalised to album/track/artist shapes,
  original `parse_embed_html` delegates to it (all 9 pre-existing scrape tests pass).
- Tests: NEW `server/tests/test_shares.py` (16), `server/tests/test_importing.py` (53),
  `test_convert_routes.py` extended additively (+8).

Frontend core (items 1, 5, 6, 7, 8 logic):
- NEW `frontend/src/services/playlistShare.ts`, `services/localFiles.ts`,
  `utils/libraryBackup.ts`, `utils/reorder.ts`; `api.ts` gained additive
  `apiPostJson`; `services/spotifyConvert.ts` generalised in place (TrackConversion
  field renamed `spotify` → `source`, with a populated deprecated alias kept for
  zero-breakage; legacy Spotify functions kept as wrappers); `utils/downloads.ts`
  gained additive `startPlaylistDownload`.
- Tests: NEW `playlistShare.test.ts` (19), `libraryBackup.test.ts` (4 — includes the
  export → wipe → import → re-export round-trip), `reorder.test.ts` (8);
  `spotifyConvert.test.ts` 21 → 66 (originals verbatim); the fallback-playlists test
  fixture updated to the new `source:` shape only.

Frontend UI (items 1, 4, 5, 6, 7, 8):
- NEW `frontend/src/hooks/useDragReorder.ts` (pointer-events, mouse + touch),
  `frontend/src/pages/library/SharePlaylistDialog.tsx` (QR via the new `qrcode`
  dependency + `@types/qrcode` in `frontend/package.json`),
  `frontend/src/components/SharedPlaylistGate.tsx` (boot `?pl=` prompt, mounted in
  `App.tsx` beside UpdateDialog).
- `PlayerContext` gained additive `reorderQueue`; `NPQueue` and `QueueTab` rows are
  drag-reorderable; `PlaylistDetailView` gained Share + Download-all (progress from
  the existing downloads store) + drag-reorder rows persisted via
  `moveTrackInPlaylist`; `SpotifyImportDialog` generalised (source-aware,
  `initialUrl`); `PlaylistsSection` gained local-files picker + Backup/Restore;
  `SearchPage` shows a link-detected import banner. `SongRow.tsx` untouched;
  nothing in `src-tauri/` or `ios/` changed.

### Final verification (coordinator, re-run independently 2026-10-23)

| Check | Baseline | Final |
|---|---|---|
| Frontend typecheck | PASS | **PASS (0 errors)** |
| Frontend vitest | 28 passed | **104 passed (5 files)** |
| Frontend production build | PASS | **PASS (~14 s)** |
| Server pytest | 75 passed | **152 passed** |
| Server module imports | all clean | **20 modules import clean** |

- Boot + flow smoke (15/15) through the real `server.__main__` app with ALL
  Telegram/Spotify credentials scrubbed (ytmusicapi stubbed per conftest pattern,
  synthetic browser.json): lifespan completes; "Telegram credentials not set —
  skipping TG cache." printed; share POST → GET round-trip preserves track order;
  re-POST of the same code updates in place; unknown code 404; junk import URL 400;
  Apple playlist URL 400 with the precise developer-token message; all six new/old
  convert+share routes mounted. NOTE: a naked production boot still requires
  `browser.json` (documented startup requirement, pre-existing on HEAD) — the smoke
  substitutes a synthetic one rather than touching Rayyan's real cookies.
- Built frontend served via `vite preview`: HTTP 200, `<title>Carmen</title>`.
- LIVE service checks (through this sandbox's egress proxy): Apple album resolve via
  the new code returned "Abbey Road (2019 Mix)" — The Beatles, 17 tracks, correct
  durations, 600px artwork. Spotify scrape resolve (no credentials) returned live
  data for ALL FOUR entity kinds: playlist "Today's Top Hits" (50 tracks), album
  "Abbey Road (Remastered 2009)" (17), single track "Never Gonna Give You Up" (1;
  album name not exposed by the track embed → null), artist The Beatles (10 top
  tracks). One sandbox quirk: httpx cannot parse this VM's NO_PROXY value (bracketed
  IPv6 entries) — the live probes ran with NO_PROXY simplified; this affects any
  httpx caller on this VM (pre-existing server code included), not the port's code.
- The already-live demo API (`https://api-carmen-v1.syr.qzz.io`) still serves real
  data (`/search` verified), but it predates this port: the new endpoints are NOT
  live there (GET probes return the SPA fallback HTML; a POST probe hung in this
  sandbox's egress proxy, a known VM quirk). Deploying is the main agent's step.
- Telegram: code-level verification only, per the scope note above — pyrogram Client
  imported in `server/__main__.py:13`, constructed only when API_ID/API_HASH/
  BOT_TOKEN are all set; `server/routes/stream.py` uses `state.tg_client`
  (send_document / get_messages / stream_media / delete_messages) behind
  `if not state.tg_client or not CHAT_ID` guards everywhere, and the boot smoke
  exercised the credentials-absent path end-to-end. NO live bot round-trip was
  performed (no credentials exist here; none invented or fetched).

### Honest remainders
- YouTube import resolution is covered by monkeypatched-core tests, not a live call
  (needs the authenticated YTM session from Rayyan's browser.json).
- Spotify OFFICIAL-API album/track/artist calls are fixture-tested only (no Spotify
  credentials here); the scrape path for the same kinds IS live-verified (above).
  If Spotify's real embed pages differ from the inferred shapes, resolution fails
  loudly with a 502, never garbage data.
- Drag-reorder interaction was verified by typecheck + unit tests of the move logic,
  not by driving a real browser (no live-browser access in this environment).
- `localFiles.ts` has no unit test (DOM File/<audio> probe surface isn't exercisable
  in the repo's node-env vitest); it is typechecked and mirrors the downloads
  completion path exactly.
- Backup downloads section is metadata-only by design (see Item 7 decision);
  playlist recreation order in the round-trip test is compared name-sorted because
  the browser fallback's createPlaylist unshifts — track order WITHIN each playlist
  and favorites are byte-exact.
- Local files also appear in the downloads catalogue, and deleting the offline copy
  deletes the local file (see Item 6 decision).
- No commit, no push, no deploy — delivery is the main agent's step.

## Fix + mobile pass — 2026-10-23 (later, from Rayyan's phone testing)

Rayyan tested the live site from his phone and reported three things: the import
dialog showed a raw "Method Not Allowed" over an empty "0 songs" state, the song
player has no "add to playlist" button, and mobile responsiveness needs a
systematic pass. Root cause of the import failure, verified against the live
API's `/openapi.json`: **api-carmen-v1.syr.qzz.io is the upstream project's
public demo server, not Rayyan's** — it has no `/convert/*` routes at all (it
predates even the original Spotify import) and cannot be updated by him. The
plan below replaces the original "server update" assumption.

### Workstream 1 (REVISED) — server-independent import + share

Goal: import and playlist sharing must actually WORK with no Carmen server,
the way Rayyan's Spotify repo does it (its server.ts ships with the site on
Vercel). The port's server endpoints stay in the repo untouched and are used
when a configured server does expose them.

- **Phase 1 (done, Worker A) — clear errors as the last-resort layer.** The
  client detects endpoint-missing responses (404 / 405 / HTTP-200 HTML from the
  SPA catch-all) in `services/spotifyConvert.ts` and `services/playlistShare.ts`
  and maps them to one message naming the configured host:
  "{Feature} isn't available on this Carmen server yet — {host} is running an
  older Carmen build without the import & sharing endpoints. Update the server
  to the latest Carmen and try again. Browsing and playback are unaffected."
  A failed resolve also clears any stale preview, so the empty convertible
  state ("0 songs / FIRST SONGS / Convert") is unreachable after a failure.
  Tests: spotifyConvert 66 → 73, playlistShare 19 → 23, all green.
- **Phase 2 (Worker D) — make it work server-free.**
  - **Resolve helper as a Vercel function**: ONE stdlib-only Python function
    under `api/` at the repo root (`api/resolve.py`, urllib/json/re only — no
    requirements.txt). It fetches Spotify embed pages (which the browser
    cannot, CORS) and returns the same resolved-preview shape the dialog
    already consumes. Parsing ported from `server/spotify_scrape.py` +
    `server/importing.py` classifiers, behaviour parity, minimal code.
    Verified enablers: iTunes Lookup sends `Access-Control-Allow-Origin: *`
    (checked by curl 2026-10-23), so Apple albums resolve client-side via
    iTunes directly — no function needed; YouTube links resolve client-side
    via the configured API's own `/playlists/{id}` and `/watch`/`/browsing`
    routes. Apple Music playlists remain classified-and-rejected with the
    precise developer-token message (no public API exists).
  - **Client-driven conversion**: `server/matching.py` ported faithfully to
    TypeScript (title 55% / artist 30% / duration 15%; matched ≥ 0.78,
    approximate ≥ 0.50, title floor 0.45 — constants verified in the source).
    Per source track, the client queries the configured API's
    `GET /search?query=` (verified live; returns title, artists[],
    duration_seconds, videoId, thumbnails; CORS open) and scores candidates
    locally; the dialog's existing progress UI is driven by this loop.
    Selection rule: a per-session cached probe checks whether the configured
    API exposes `/convert/resolve` (JSON answer = yes; HTML-200 = no). Server
    path only when the probe says yes; otherwise client-driven. Carmen-share
    links never convert (registry or payload, below).
  - **Share payload fallback**: when a per-session probe says the configured
    API lacks `/share/*`, `SharePlaylistDialog` falls back to a self-contained
    link — the playlist payload (name + per-track videoId/title/artists/
    duration) gzip-compressed via the browser-native `CompressionStream` +
    base64url (no new dependency) in `?pl=` under a `plz_` prefix (registry
    codes stay `pl_…`). `SharedPlaylistGate` and the import dialog decode both
    forms. Payload links are capped (cap + rationale logged by Worker D);
    beyond the cap the dialog says the playlist is too large to share without
    a Carmen server. The registry path stays first-choice when available;
    QR + copy + native share work on whichever link was produced.
  - **Last resort**: when neither server endpoints nor the helper/codec path
    can run, Phase 1's clear error is what the user sees — never a raw
    "Method Not Allowed", never the empty convertible state.
  - **Function verification**: the Vercel function is exercised locally
    against REAL Spotify playlist and album URLs and its output compared with
    `server/importing.py`'s resolve for the same links. The deployed project
    builds via custom commands with `outputDirectory frontend/dist`; a root
    `api/` directory is picked up by Vercel automatically and must not
    disturb that build (to be noted in the log after verification).

### Workstream 2 — "Add to playlist" in the song player (Worker B)

`PlayerMenu` (rendered by the now-playing sheet) gains an "Add to playlist"
entry opening the EXISTING `AddToPlaylistDialog` for the current track —
reuse, no second UI — plus a mobile audit of the player surface (sheet,
mini player, transport controls, queue).

### Workstream 3 — Mobile responsiveness pass (Worker C)

App-wide audit at 360–430px: dialog base in `components/ui/Overlay.tsx`
(safe-area-aware container padding, `max-h-[92dvh]`, bounded width), ≥44px
menu rows, no horizontal overflow at the root, per-view fixes logged
before → after. Same look, properly fitted; desktop must not regress.

### Verification gates for this pass

Baselines re-confirmed before any fix-pass edit: typecheck PASS, vitest
104/104, production build PASS, server pytest 152/152 (unchanged — this pass
touches no server code except adding the root `api/` function, which is not
part of the FastAPI app). Final: typecheck PASS, vitest all green (104 + new
tests for the matching port, the payload codec, probe/fallback selection and
the Phase-1 detection), production build PASS from the repo-root layout,
and the `api/` function exercised locally per above. Final on-device proof
is Rayyan's phone.

### Fix + mobile pass — completion record (coordinator, 2026-10-23)

All four workers landed; the coordinator re-ran the final gates independently
on the integrated tree (not just the workers' own runs):

| Check | Port baseline | Fix-pass final |
|---|---|---|
| Frontend typecheck | PASS | **PASS (0 errors)** |
| Frontend vitest | 104 passed | **174 passed (6 files)** — spotifyConvert 91, playlistShare 31, matching 33 (new), fallback 7, libraryBackup 4, reorder 8 |
| Frontend production build | PASS | **PASS (~16 s; bundle 781.88 kB / gzip 250.99 kB)** |
| Server pytest | 152 passed | not re-run — no `server/` file changed by this pass (the only addition is the root `api/` Vercel function, outside the FastAPI app) |

**Workstream 1 outcome.** Selection rule: two per-session cached probes
(one request each). `convertServerAvailable()` — GET `/convert/resolve`
with a junk probe URL; JSON (any status) = use the server path unchanged,
HTML/unparseable/network failure = client-driven. `shareRegistryAvailable()`
— GET `/share/playlists/pl_probe_absent`; JSON 404 = registry, otherwise
payload fallback. Carmen-share links never probe: `plz_…` decodes locally.
- `api/resolve.py` (NEW, repo root, stdlib only): classifies Spotify
  playlist/album/track/artist, fetches embed pages, ports
  `parse_embed_entity` faithfully (502 on missing track list, never
  partial), mirrors `/convert/resolve` field-for-field (snake_case
  `track_count`, `isrc`), JSON + `Access-Control-Allow-Origin: *` on every
  response. Exercised locally against REAL links and compared with
  `server/importing.py` via the repo venv: playlist (50 tracks), album
  (10), track (1) — source + full tracklists identical; junk / non-Spotify /
  missing param → 400 JSON.
- `services/matching.ts` (NEW): faithful TS port of `server/matching.py`
  (incl. a difflib `SequenceMatcher.ratio()` implementation; title 55% /
  artist 30% / duration 15%, matched ≥ 0.78, approximate ≥ 0.50, title
  floor 0.45). 33 parity tests ported from `test_matching.py` after
  re-verifying the Python values numerically.
- Client resolve/convert in `spotifyConvert.ts`: Spotify via same-origin
  `/api/resolve`; Apple album via iTunes Lookup direct (CORS `*` verified;
  600px artwork, disc/track sort); Apple playlist → the server's exact
  developer-token rejection string; YouTube playlist via `/playlists/{id}`,
  video via `/browsing/track/{id}` with `/watch` fallback (live probes
  established the old build's actual shapes — `/playlists` is ytmusicapi
  raw, `/watch` uses `length`/`thumbnail` singular). Convert loops
  `matchTrack` over `GET /search?filter=songs&limit=15` with
  server-identical progress/order/abort/per-track-error semantics; YouTube
  kinds emit matched@1.0 unsearched. No dialog changes were needed;
  `SharedPlaylistGate` untouched (handled centrally).
- Share payload fallback: gzip (CompressionStream) + base64url codec,
  `plz_…` prefix parsed in both `parsePlaylistShareCode` and
  `detectImportLink`, decoded locally in `resolveSharedPlaylist`. **Cap:
  final URL > 8,000 chars** → "too large to share as a self-contained link
  without a Carmen server" error (≈90–120 typical tracks). The dialog
  labels payload shares "Self-contained link — works without a Carmen
  server" instead of dumping the token as a code.
- Phase 1 (Worker A) remains the last-resort layer, intact: the exact
  shipped wording is "{Playlist import|Playlist sharing} isn't available on
  this Carmen server yet — {host} is running an older Carmen build without
  the import & sharing endpoints. Update the server to the latest Carmen
  and try again. Browsing and playback are unaffected." (host =
  `api-carmen-v1.syr.qzz.io` in production). A failed resolve clears any
  stale preview — the empty convertible state is unreachable.
- Vercel safety: no vercel.json exists or was created; root `api/` is
  auto-detected and sits outside the custom frontend build (re-verified
  PASS after adding it); the pre-existing `.vercelignore` does not exclude
  `api/`.

**Workstream 2 outcome (Worker B).** `PlayerMenu` gains an "Add to
playlist" entry (after Share, before "Go to artist") opening the EXISTING
`AddToPlaylistDialog` for the current track — same import/state/props
pattern as SongRow, no new UI; the track-change effect also resets the
dialog state so a stale picker can't add the previous song. Layering
verified against the kit's shared `openLayers` stack: the picker opens
above the player sheet and closes alone. Player mobile fixes: scrubber hit
area 16px → 44px, favourite/MiniPlayer/menu-trigger → 44px, sheet tab
padding + title `min-w-0` marquee + short-screen (≤720px height) cover
caps, queue drag handles 28px → 40px, queue headers wrap,
`overflow-x-hidden` guards. Drag-reorder wiring byte-identical apart from
sizing/wrap classes.

**Workstream 3 outcome (Worker C).** Dialog base: safe-area-aware
container padding, panel `max-h-[85vh]` → `max-h-[92dvh]` (328px panel at
360px), actions wrap and stay outside the scroll area; Menu viewport-
bounded with 44px rows; kit-wide phone-only (`max-sm:`) 44px minimums
(Button, IconButton, Tab, ListItemButton, ToggleButton, small TextField,
clickable Chips); Switch gains an invisible 44px hit area; ListItemText
secondary text wraps instead of truncating; `styles.css` gains an explicit
root `overflow-x: hidden` and a <600px 16px form-field rule (stops iOS
focus zoom-shift). Per-view fixes: library PageSummary wraps (was ~436px
of buttons on a 360px screen), PlaylistDetailView drag handle → 44px,
Settings 4-segment artwork-placement group → 2×2 grid on phones,
ManageDownloads select-all → 44px, Collection/Artist Play/Shuffle rows
wrap. Home/Search/Library/Song pages and TrackRow/MediaCard audited clean.
Full before→after tables: worker notes A–D (fix-pass working papers).

**Honest remainders for this pass.**
- The `api/resolve.py` Vercel pickup is proven locally (stdlib harness,
  byte-identical output vs the server) but can only be proven end-to-end
  on the deployed project — the main agent's deploy + live test is the
  confirming step.
- All mobile width claims are class arithmetic at 360px / ≤720px heights,
  not device screenshots. Five spots specifically need Rayyan's phone:
  TrackRow ⋯ (now 44px) vs the row's 48px right reserve; the Settings 2×2
  `max-sm:grid` override; the Playlists card-corner button growing
  30px → 44px over artwork; Switch hit-area double-toggles in dense rows;
  dialog safe-area padding on an edge-to-edge device.
- Client convert re-resolves once inside the convert step (mirrors the
  server flow, where `/convert/to-ytmusic` also re-resolves).
- Sub-epsilon divergences from Python matching: difflib autojunk (>200
  chars, unreachable for normalized titles) and banker's rounding in
  confidence — neither can flip a status at the asserted test points.
- No commit, no push, no deploy — delivery is the main agent's step.

## Playlist offline download — 2026-10-23

Rayyan: "Make me able to download entire playlists locally with one button
and it actually plays offline." The offline machinery itself already
existed (IndexedDB blobs on web, offline-first playback, boot hydration);
what was missing was reach, pacing and durability:

**What was missing**
1. Remote playlists/albums (Home/Search/YouTube → `CollectionPage`) had
   no download affordance at all — only library playlists did.
2. `startPlaylistDownload` fired every track at once: a 50-song playlist
   meant 50 parallel full-file fetches, which phones punish with failed
   downloads.
3. Nothing ever called `navigator.storage.persist()`, so the browser
   could evict the whole IndexedDB download store under storage pressure
   and offline playback would silently die days later.

**What changed**
- `pages/CollectionPage.tsx` — one "Download all" button beside
  Play/Shuffle (albums too), mirroring `PlaylistDetailView`'s pattern:
  label cycles "Download all" → "Downloading X/N" (with the same progress
  bar) → "Downloaded" (check icon, disabled). The click first saves the
  collection into the library as a playlist, then starts downloads via
  the existing `startPlaylistDownload`; both load lazily on click, like
  every other download trigger. Done-count = done jobs ∪ the offline
  catalogue, so tracks saved in earlier sessions count too.
- `utils/collectionPlaylist.ts` (new) — `ensureCollectionPlaylist(name,
  tracks)`: returns the existing library playlist when one has the same
  name AND the same ordered videoId list, otherwise creates and fills a
  new one via the playlist repo functions. Tracks without a videoId are
  skipped.
- `utils/downloadQueue.ts` (new) — the shared FIFO queue every download
  now passes through: `createDownloadQueue(limit)` +
  `MAX_CONCURRENT_DOWNLOADS = 3` + the `downloadQueue` singleton. A task
  that must wait fires `onQueued`; the slot is released before the
  caller's promise settles, failure included, so a bad track can never
  stall the queue.
- `utils/downloads.ts` — `startDownload`'s pipeline body was extracted
  into `runDownload` (behaviour byte-identical: same steps, retries,
  notices, per-track error isolation) and is now scheduled through
  `downloadQueue`; a queued job shows status `running`, step `Queued`,
  and the working label is restored when it starts. Single downloads
  (DownloadButton, PlayerMenu, smart download) go through the same queue
  automatically. `startPlaylistDownload` additionally fires
  `ensurePersistentStorage()` first. Signatures unchanged; the library
  PlaylistDetailView button works exactly as before.
- `services/storage/persist.ts` (new, re-exported from
  `services/storage/index.ts`) — `ensurePersistentStorage()`: web only
  (no-op on Tauri or when the Storage API is missing), returns true when
  already persisted without re-requesting, at most one `persist()`
  request per session, failures resolve `false` instead of throwing.
- `main.tsx` — boot now calls it when the hydrated catalogue is
  non-empty (right after the downloaded-flags hydration), so an existing
  offline library asks for durability on every launch, not only when a
  new playlist download starts.

**Gates** — typecheck 0 errors; vitest **188/188** (174 baseline + 14
new: downloadQueue 3 — max-3 concurrency, FIFO drain, failure releases
the slot; persist 6 — already-persisted, requests once, declined,
missing API, Tauri no-op, rejecting API; collectionPlaylist 5 — create
in order, dedupe reuse, order/name mismatch creates anew, id-less
tracks skipped); production build from the repo-root layout passes
(the new helper splits into its own 0.44 kB lazy chunk). Frontend only —
no `server/`, `src-tauri/` or `ios/` changes; no new dependencies.

**Not verified here** — on-device behaviour: an actual phone download
run, the browser's real persist grant/deny, and IndexedDB surviving an
eviction pass are only provable on Rayyan's phone against the deployed
site (the main agent's delivery step).

## Stats + Wrapped, sleep timer, Discover, smart downloads, mobile pass 2 — 2026-10-24

Rayyan's picks from the starred list (items 1–4) + mobile pass 2 + a Discover tab
+ "give me more". Built by a coordinator with four parallel workstreams
(stats, sleep timer, Discover, smart downloads) + an integration step + a
mobile pass over the integrated tree. Web frontend ONLY (frontend/, Vite +
HashRouter), fully client-side/server-free against the upstream demo API
(https://api-carmen-v1.syr.qzz.io — not Rayyan's; nothing here needs a Carmen
server). No new dependencies. No push, no deploy — delivery is the main
agent's step.

### Scope corrections applied during this build (binding)
- The bonus items (Downloaded-only toggle, storage manager view, wake lock)
  were CANCELLED by Rayyan mid-build: none were built, and a final grep
  confirms zero matches for wakeLock / StorageManager / Downloaded-only in
  frontend/src (the only "wake" wording left is a sleepTimer comment about
  a timer waking after reload — not a wake lock).
- A CarPlay iOS track was added, then CANCELLED by Rayyan ("web only, no
  apps"): the iOS worker was shut down before it touched anything and
  `git status ios/` is clean — nothing to revert. Final scope is web
  items 1–6 only.

### 1. Listening stats + Wrapped
- New: `utils/stats.ts` + `utils/stats.test.ts` (20 tests),
  `hooks/usePlayStats.ts` (listener hook + zero-render `PlayStatsWatcher`),
  `pages/StatsPage.tsx`, `components/WrappedView.tsx`. Mounted by the
  coordinator: route `/stats`, nav entry "Stats" (new `ChartIcon` glyph in
  `components/icons.tsx`), `<PlayStatsWatcher />` in `Layout.tsx` beside
  `<SmartDownloadWatcher />` (counting is dormant until that mount — it is
  in place in this tree).
- Counting rule (documented in code + UI): a play counts when playback
  passes 30 seconds OR the track completes, whichever comes first; skipping
  before 30s never counts. Minutes sum each counted play's furthest
  playhead reached (capped at track duration), not plays × full length.
- Anti-double-count: one counted play per track-start session; seeks,
  rewinds, repeat-one loops, StrictMode double-effects and the `ended` +
  playhead-watchdog double-fire cannot double-count. A replay after another
  track is a new session and legitimately counts again.
- Storage: the EXISTING KV layer only (`services/storage`, one key
  `playHistory.v1`, capped at 2,000 records). No new store, no migration.
- Views: top tracks, top artists (collabs credit every artist), 7d / 30d /
  all-time windows (boundary-inclusive), total minutes, current streak
  (consecutive local days; a missing today keeps yesterday's streak alive,
  a gap breaks it), Wrapped summary (top track/artist, minutes, plays,
  streak). Genre is OMITTED deliberately: Carmen's normalized Track shape
  carries no genre, and none was invented (WrappedView says so).

### 2. Working sleep timer (session-scoped)
- New: `utils/sleepTimer.ts` (pure countdown state machine + fade curve) +
  `utils/sleepTimer.test.ts` (13 tests). `PlayerContext.tsx` gained additive
  timer state + driver only; `PlayerMenu.tsx` gained the timer section +
  countdown pill. No other playback logic touched.
- Options: Off / End of track / 15 / 30 / 45 / 60 minutes. On expiry the
  volume fades over ~10s (20 steps × 500ms, cosine-ease) then `audio.pause()`
  fires, and volume is restored to its pre-fade value immediately after the
  pause (a later manual resume plays at normal volume). Cancel mid-fade
  restores volume and playback continues; changing mid-countdown resets
  from now; minute timers keep running across track changes.
- End-of-track detection: PlayerContext's existing `handleTrackEnded` (the
  single entry point for `<audio>` `onEnded` + the duration − 0.25s
  watchdog, guarded so one song ends once) calls the sleep handler BEFORE
  repeat/queue logic — fade-and-pause replaces advancing and beats
  repeat-one. An end-of-track timer is bound to the videoId playing when
  set; a manual move to another track clears it.
- Remaining time shows as a tappable countdown pill in the player-sheet
  header (`14:32`, `End of track`, `Fading out…`; tapping reopens the menu)
  and on the active menu row. NOT on the mini player (PlayerMenu is not
  rendered there; MiniPlayer was out of scope for this slice).
- Session scope, documented: in-memory only, NOT persisted, NOT written to
  the playback-persistence snapshot — a persisted timer could wake up with
  a stale deadline and pause an abandoned session.

### 3. Discover / Daily Mix (client-generated)
- New: `services/dailyMix.ts` + `dailyMix.test.ts` (12 tests).
  Sources: the user's own library + favorites only (favorites via
  `listFavorites()`, playlist tracks via `listPlaylists()` +
  `listPlaylistTracks()`, plus recents/suggestions from the library
  snapshot), deduped by videoId. Related tracks come from the existing
  `GET /browsing/related/{videoId}` endpoint, best-effort — a failure just
  omits the "More like" section, never breaks the mix.
- Determinism: FNV-1a hash of `date + sorted track ids` seeds a mulberry32
  PRNG; no `Math.random`. Same day + same library → byte-identical mix
  (proven by test). Date-keyed cache under `carmen:daily-mix:v1`
  (localStorage, in-memory fallback); today's mix is reused, a new day or
  "Refresh mix" regenerates; a stored EMPTY mix is not sticky (regenerates
  once the library has tracks).
- Explainability: every section carries its reason — "From your
  favourites", "Because you liked {artist}" (most frequent artist, ties
  broken alphabetically), "More like {song}", "From your library". Empty
  library → honest empty state, never invented tracks; a track appears at
  most once across sections.

### 4. Smart downloads
- New: `services/smartDownloads.ts` + `smartDownloads.test.ts` (16 tests).
  Settings keys (all default off except Wi-Fi-only on):
  `smartDownloadLiked` (false), `smartDownloadFavPlaylists` (false),
  `smartDownloadWifiOnly` (true), `smartDownloadAllowMetered` (false),
  `smartDownloadExcludedPlaylists` ([]). Settings UI in SettingsPage
  (toggles + gating copy + status line + per-playlist opt-out list);
  status line also at the top of ManageDownloadsPage; launch hook in
  `main.tsx` (self-contained block after `ensurePersistentStorage`);
  additive `AppSettings` fields in `types/models.ts`.
- Triggers: app launch (after catalogue/flags hydration), a song favourite
  being added (flags-store watcher, debounced 1.5s), toggle-on, Library
  visits. Runs coalesce (in-flight dedupe + 10s same-settings cooldown;
  toggle-ons force). Playlist favourites are NOT instant (favouriting a
  playlist does not patch the flags store) — they are picked up on next
  launch, Library visit, or toggle-on.
- Pipeline reuse only: `startPlaylistDownload` → `startDownload` → 3-wide
  FIFO `downloadQueue`; already-downloaded tracks filtered twice;
  per-group failures never stall the queue; a failing source degrades
  rather than failing the run. Status line is live-derived ("downloading
  N · queued N · N saved", or saved/failed/already-on-device counts, or
  "paused — <gate reason>"); "Done" means handed to the pipeline, and
  per-track completion is the job counts.
- Honest Wi-Fi gating (in code header, tests, and UI copy): the web cannot
  reliably distinguish Wi-Fi from cellular — `navigator.connection` is
  absent in Safari/Firefox and `effectiveType` measures speed, not radio.
  So `wifi`/`ethernet` pass; `cellular`, `saveData`, `none`, unknown/missing
  type, or a missing connection object are all treated as METERED (safe
  default) and block unless "Allow on metered connections" is on. With
  "Wi-Fi only" switched off the user has lifted the restriction themselves
  (except `none`, which always blocks). Toggle labelled "Wi-Fi only (best
  effort)".

### 5. Mobile responsiveness pass 2
- Audit at 360–430px (class arithmetic + code inspection — no live browser
  in this role, stated plainly). New screens verified: Stats/Wrapped
  (328px content at 360px, tabs/cards/truncation all fit), Discover (see
  below), timer UI, smart-download settings (all toggles 44px hit areas,
  status lines wrap).
- Fixes landed: (a) Discover "Refresh mix" button gained `shrink-0`
  (could wrap to two lines); (b) sleep-timer countdown pill raised to a
  real 44px tap target (`min-h-11`, vertically centred); (c) Manage
  Downloads header row gained `flex-wrap` (count + buttons exceeded 328px
  on narrow screens); (d) Settings per-playlist opt-out rows gained
  `py-2.5` (28px pitch vs 44px hit areas overlapped by 16px — a tap near a
  row edge could toggle the row below; now 48px pitch, 4px clearance);
  (e) bottom nav (now 7 items) narrowed to `max-sm:px-0.5
  max-sm:text-[10px]` so all seven labels render in full at 360px
  (51px slots; labels ≈40px) instead of truncating to "Settin…"/"Discov…".
- Five 2026-10-23 re-checks: (a) TrackRow ⋯ vs 48px reserve — FIXED, it was
  a real overlap (trailing slot is 106px: 16 offset + 34 duration + 8 gap +
  44 button + 4 pad; reserve was 48px, so ~58px of title slid underneath
  the duration/⋯; reserve changed 48 → 110, width-independent).
  (b) Settings 2×2 grid override — VERIFIED via the production CSS
  (`.max-sm:grid` inside `@media not all and (min-width:600px)` wins over
  base `.inline-flex`; 145px per segment at 360px, 44px tall). Note: this
  build's `max-sm` breakpoint is <600px, not 640px. (c) Playlists
  card-corner button — VERIFIED, no change: the 30px classes are overridden
  by kit `max-sm:min-h-11 max-sm:min-w-11`, so the phone target is already
  44×44px (desktop stays 30px). (d) Switch double-toggles — FIXED where
  real (see (d) above); all other Switch rows carry ≥2-line descriptions
  (pitch ≥54px) and are safe. (e) Dialog safe-area padding — VERIFIED:
  kit Dialog uses `pt/pb-[max(1rem,var(--sa*))]`, side insets via
  `env(safe-area-inset-*)`, panel `max-h-[92dvh]`; the player sheet is a
  deliberate edge-to-edge override with its own insets.
- Deliberately left: when a sleep timer runs, the ⋯ button (shifted left by
  the pill) can sit over the decorative centred "NOW PLAYING" eyebrow in
  the sheet header. The eyebrow is `pointer-events-none` and both buttons
  stay fully tappable with no overflow; fixing it properly needs the
  header to subscribe to timer state (per-second re-renders) — flagged for
  Rayyan's phone check rather than hacked with CSS.

### 6. Discover tab — "Best right now" (LIVE data only)
- New: `services/discover.ts` + `discover.test.ts` (7 tests),
  `pages/DiscoverPage.tsx`. Mounted by the coordinator: route `/discover`,
  nav entry "Discover" (MusicNoteIcon).
- Charts-endpoint outcome, proven live 2026-10-24 (GET-only probes):
  `GET /browsing/charts` EXISTS (HTTP 200) with shape `{countries, videos,
  artists}` — 40 ranked artists (`rank`, `trend`, `subscribers`,
  `browseId`) and 2 chart video playlists, but NO songs list. So charts
  honestly powers trending artists only, not trending songs.
  `GET /browsing/explore` EXISTS (HTTP 200): trending feed with 20 songs
  (with `videoId`) plus 24 new releases (albums/singles).
  `/browsing/home` was checked and NOT used — its rows are personalized
  quick picks, not a trending feed.
- Fallback decision (no faking): trending songs from explore's trending
  feed; trending artists from charts (payload `rank` verbatim, sorted by
  it); new releases from explore. No ranking is hardcoded, seeded, or
  faked — song order is the payload's order. A section whose live source
  comes back empty is omitted; one endpoint failing does not kill the
  other's sections; only a double failure shows the error state.
- Exact UI labels (honest labelling): songs section "Trending on YouTube
  Music" (explicitly NOT "Charts"), subtitle "What people are listening
  to right now"; artists "Trending artists", subtitle "Ranked by the
  YouTube Music charts (Global)" (country from
  `charts.countries.selected.text`); releases "New releases", subtitle
  "Fresh albums and singles on YouTube Music"; header note: "Live from
  YouTube Music — nothing here is ranked by Carmen." Artist rows show rank
  + trend mark (▲/▼/–) and route to `/artist/:browseId`; releases render
  as MediaCards to `/collection/album/:id`; songs play via the existing
  player context. Refresh: "Refresh Discover" button + Home-style
  pull-to-refresh (≥90px drag at `#app-main` scroll top).

### Final gates (coordinator, re-run independently on the integrated tree)
- Frontend typecheck: PASS, 0 errors (`npm run typecheck`).
- Frontend vitest: **256/256 passed, 14 files** — baseline 188 + 20 stats +
  13 sleep timer + 19 discover + 16 smart downloads. (Intermediate runs
  during parallel work showed failures in other streams' mid-edit files,
  including `stats.test.ts` — all resolved; the integrated runs are fully
  green. Mobile pass 2 changed no test files and the suite stayed 256/256.)
- Production build from the repo-root layout: PASS
  (`npm --prefix frontend run build`, ~15s; bundle 826.06 kB / gzip
  263.84 kB).
- Scope grep: zero matches for wakeLock / StorageManager / Downloaded-only
  in frontend/src; `ios/` clean; no `server/` / `src-tauri/` changes from
  this build (the `server/` modifications in the tree are the pre-existing
  2026-10-23 port work).

### Honest remainders (need Rayyan's phone / a real browser)
- End-to-end counting: play a song past 0:30, open /stats, confirm 1 play;
  reload, confirm it persists. Stats start empty for everyone (no backfill
  from the recents feed — that feed records track starts, not
  30s/completion, and backfilling it would violate the counting rule).
- Real fade + `audio.pause()` on a phone (pure machine + driver tested,
  no component renderer in this repo); background-tab throttling may delay
  fade start until the tab is foregrounded (deadline is wall-clock, so
  expiry itself is never lost); after an end-of-track sleep pause, pressing
  play on the finished track will not auto-advance (existing
  `trackEndedRef` guard) — press Next; minute-timer pauses resume
  mid-track normally.
- Discover page itself is typechecked, not browser-verified: open
  /discover once deployed and confirm Daily Mix against a real library,
  trending sections against the live demo API, and pull-to-refresh on a
  phone.
- Smart downloads on-device: an actual phone run (toggles on, Wi-Fi vs
  cellular), the real persist/queue behaviour under a 50-song playlist,
  and the status-line wording on a small screen — plus the structural
  Wi-Fi limitation (browsers without `navigator.connection.type` report
  "treated as metered" and sit paused until the metered opt-in).
- Mobile pass 2 is arithmetic, not device proof: real tap feel, 10px
  nav-label readability, the TrackRow fix, dialog safe-area on a true
  edge-to-edge device (notch/dynamic island — `env()` insets are 0px
  elsewhere), pull-to-refresh feel, and the sleep-pill-over-eyebrow
  cosmetic note above all deserve a 30-second eyeball on his phone.
- No push, no deploy — delivery is the main agent's step.
