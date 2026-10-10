# 🎧 Carmen

![Tauri](https://img.shields.io/badge/shell-Tauri_v2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/client-React_18-61DAFB?logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/server-FastAPI-009688?logo=fastapi&logoColor=white)
![Tailwind](https://img.shields.io/badge/styling-Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)

**An offline-first, cross-platform music player for YouTube Music.**
Stream anything, download it in one tap, and keep playing when the network
doesn't — with synced lyrics, lock-screen controls, and artwork that never
goes blurry.

Carmen ships as a native desktop app (**Tauri v2** — macOS, Windows, Linux)
and as a **web app** you can add to your home screen on iOS. Both talk to a
tiny **FastAPI** backend that wraps YouTube Music, caches what it can
(Redis + Telegram + disk), and never leaks upstream stream URLs.

---

## ✨ Features

- **Play anything** — search, browse, home feeds, playlists and podcasts
  straight from YouTube Music.
- **One-tap downloads** — audio + high-res cover + synced lyrics (+ the
  animated cover when the album has one) live in the app's own sandbox.
  Downloads play from disk first and need zero network.
- **A streaming ladder that just starts** — disk copy → Telegram-cached
  copy → live relay, with size-verified integrity checks and a background
  backfill so the cache heals itself.
- **Lyrics that follow the song** — line-by-line synced karaoke when the
  lyrics exist, plain scrolling text otherwise.
- **Proper media integration** — media keys, lock screen / notification
  controls and the OS's own artwork (the downloaded cover, not a 480p
  thumbnail), everywhere.
- **A UI that reads the room** — ambient background tinted from the cover,
  dark/light themes, motion artwork where albums have it.
- **Degrades quietly** — no Redis? Uncached. No Telegram? Streams anyway.
  No network? Your downloads still play.

## 🏗 Architecture

```
 ┌──────────────────────────────┐        ┌──────────────────────────────────┐
 │  Client (React + TypeScript) │  HTTPS │  Server (FastAPI + ytmusicapi)   │
 │  ├─ Tauri v2 desktop shell   │ ─────▶ │  ├─ Redis     · response cache   │
 │  └─ web app (iOS home screen)│  JSON  │  ├─ Telegram  · song cache       │
 │                              │ +audio │  └─ disk      · stream cache     │
 │  offline files in the app    │ ranges │                                  │
 │  sandbox (or IndexedDB)      │ ◀───── │  /stream proxies the audio —     │
 └──────────────────────────────┘        │  upstream URLs never leave       │
                                        └──────────────────────────────────┘
```

| Path         | What lives there                                                   |
| ------------ | ------------------------------------------------------------------ |
| `frontend/`  | React client — Vite build → a static `dist/` (works in any browser, and is the whole desktop app). |
| `server/`    | The FastAPI app — browsing / search / watch / playlists / podcasts over `ytmusicapi`. |
| `src-tauri/` | The Tauri v2 shell (Rust) — asset protocol, sandboxed file system, SQL, bundling. |
| `DEVELOPMENT.md` | The deep dive: layout, offline model, theming, media session, gotchas. |

## 🚀 Quick start (development)

You need **Node 18+** and, for the desktop app, a **Rust toolchain**. The
server is optional in dev — the client boots against the public demo API and
you can point it anywhere from *Settings → Server URL*.

```bash
git clone https://github.com/z44d/Samma3ni.git && cd Samma3ni
npm install

npm run dev           # desktop app (Tauri dev, hot reload)
npm run dev:frontend  # web client only → http://localhost:1420
```

Running your **own server** (see below for the full production story):

```bash
python3.11 -m venv venv
./venv/bin/pip install -r server/requirements.txt
cp /path/to/your/browser.json .        # authenticated YT Music cookies — never commit it
./venv/bin/python -m server            # from the repo root → http://localhost:8000/docs
```

## 📦 Deploying to production

Three independent pieces — deploy any subset.

### 1 · The server

**Requirements:** Python 3.11, Redis, [Bun ≤ 1.3.14](https://bun.com)
(stream-signature decryption runs through it — newer Bun is rejected by
yt-dlp/ytmusicapi), and a `browser.json` holding live YouTube Music cookies.

```bash
git clone https://github.com/z44d/Samma3ni.git /opt/carmen && cd /opt/carmen
python3.11 -m venv venv
./venv/bin/pip install -r server/requirements.txt
```

Configuration is environment-only (a `.env` in the working directory is
loaded automatically):

| Variable     | Default        | What it does                                                        |
| ------------ | -------------- | ------------------------------------------------------------------- |
| `PORT`       | `8000`         | Port uvicorn binds to (`0.0.0.0`).                                  |
| `BROWSER_PATH` | `browser.json` | The authenticated cookies file the API boots with.                 |
| `API_ID`     | –              | Telegram `api_id` (optional — enables the song cache).              |
| `API_HASH`   | –              | Telegram `api_hash` (optional).                                     |
| `BOT_TOKEN`  | –              | Bot token used to mirror songs into Telegram (optional).            |
| `CHAT_ID`    | –              | Telegram chat that stores the cached songs (optional).              |
| `TG_NAME`    | `ytmusic_cache` | Telegram session name.                                             |
| `DEBUG_LOGS` | off            | `1` → colored per-request logs, stream-tier traces, startup banner. |

Then run it under any supervisor — e.g. systemd:

```ini
# /etc/systemd/system/carmen.service
[Unit]
Description=Carmen API
After=network.target redis.service

[Service]
WorkingDirectory=/opt/carmen
EnvironmentFile=/opt/carmen/.env
ExecStart=/opt/carmen/venv/bin/python -m server
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Put TLS in front of it — the web client needs HTTPS, and audio range
requests benefit from a real proxy. With Caddy that's two lines:

```caddyfile
api.carmen.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

Notes:

- Redis is expected on `localhost:6379` (default client). If it's down the
  API keeps serving — every response is simply uncached.
- Without the Telegram variables, songs still stream; the instant cache is
  just skipped.
- `browser.json` must contain a fresh `cookie` field from an authenticated
  youtube.com/music session — rotate it when search starts failing.
- Interactive API docs ship at `/docs` and `/redoc`.

### 2 · The frontend

The web app is a pile of static files. The API base URL is **baked at build
time** (it defaults to the public demo server):

```bash
cd frontend
VITE_API_BASE=https://api.carmen.example.com npm run build   # → dist/
```

Ship `dist/` on any static host — nginx, Caddy, Cloudflare Pages, GitHub
Pages. Two rules:

- `index.html` → no cache; `/assets/*` (content-hashed) → cache forever:

  ```nginx
  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
  location = /index.html { add_header Cache-Control "no-cache"; }
  ```

- **HTTPS is required** on iOS for *Add to Home Screen* (the app runs
  full-screen standalone) and for the browser's persistent storage.

CORS is already open on the API (`*`), so any origin works. Users can still
repoint the app at another server from *Settings → Server URL* — it overrides
the build-time base per request, no rebuild needed.

### 3 · The desktop app

```bash
npm install
npm run build     # typecheck → frontend build → tauri build
```

Installers land in `src-tauri/target/release/bundle/` — `.app`/`.dmg` (macOS),
`.msi`/`.exe` (Windows), `.deb`/`.AppImage` (Linux). Code signing and
notarization are configured through Tauri's standard `APPLE_*` /
signing-secret environment variables.

## 💾 Data & storage

Downloads live in the app's own data directory (identifier
`com.z44d.carmen`):

| OS      | Path                                                              |
| ------- | ----------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/com.z44d.carmen/`                  |
| Windows | `%APPDATA%\com.z44d.carmen\`                                      |
| Linux   | `~/.local/share/com.z44d.carmen/`                                 |
| Web     | the browser's own storage (IndexedDB) — nothing touches your files |

```
songs/<videoId>/
├── audio.m4a        # the stream, stored verbatim
├── artwork.jpg      # best available cover (maxresdefault when it exists)
├── lyrics.lrc       # synced lyrics when the song has them
└── motion.mp4       # animated cover, when the album has one
```

## 🧠 Worth knowing

- **Bun must stay ≤ 1.3.14** — the audio pipeline shells out to Bun for
  signature decryption and newer versions are rejected upstream.
- **No stream URLs ever leave the API** — responses are sanitized
  (tracking tokens stripped) and audio is proxied, Range-aware, through
  `/stream`.
- The web and desktop clients share one codebase; the shell decides the
  storage backend (sandbox files vs. IndexedDB).

## 📚 More

`DEVELOPMENT.md` covers the architecture in depth — offline model, theming,
media session, animations, and the full gotcha list.
