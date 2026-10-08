# Carmen — Development Guide

Carmen is a cross-platform, offline-first music player built around YouTube
Music. This guide is the single source of truth for setting up, running,
building and releasing it.

---

## 1. Project overview

Carmen is three cooperating pieces:

| Piece | Location | Technology |
|---|---|---|
| Desktop / Android shell | `src-tauri/` | Tauri v2 (Rust), identifier `com.samma3ni.carmen` |
| App UI | `frontend/` | React 18 + TypeScript + Vite 6 + MUI |
| Music backend | `server/` | FastAPI wrapping `ytmusicapi` + `yt-dlp` |

```text
        ┌──────────────────────────────────────────────────────────┐
        │  Tauri v2 shell — src-tauri/ (Rust)                      │
        │  identifier: com.samma3ni.carmen                         │
        │  · close-to-tray lifecycle + system tray (src/tray.rs)   │
        │  · commands: app_info, storage_paths, battery_status     │
        │  · plugins: fs · sql (SQLite) · opener · window-state    │
        │  · asset protocol + fs scope: $APPDATA/**                │
        │                                                          │
        │   ┌──────────────────────────────────────────────────┐   │
        │   │ WebView ── frontend/ (React + TypeScript)        │   │
        │   │ built by Vite → frontend/dist                    │   │
        │   └──────────────────────────────────────────────────┘   │
        └───────────────────────────┬──────────────────────────────┘
                                    │  HTTP JSON  (VITE_API_BASE,
                                    │  default → remote demo server,
                                    │  local → http://localhost:8000)
                                    ▼
        ┌──────────────────────────────────────────────────────────┐
        │  FastAPI backend — server/ (PORT, default 8000)          │
        │  routes/*.py → core.py (YTMusic client) → YouTube Music  │
        │  @cached → Redis localhost:6379                          │
        │  @sanitized → strips tracking tokens + stream URLs       │
        │  yt-dlp resolves/plays streams, caches audio on disk     │
        └──────────────────────────────────────────────────────────┘
```

### Repo layout

| Path | What it is |
|---|---|
| `package.json` (root) | Workspace-less root scripts: `dev`, `build`, `typecheck`, `icons`, `android:init` — all delegate into `frontend/` or `src-tauri/` |
| `package-lock.json` (root) | Pins `@tauri-apps/cli` (2.12.x) — this is the lockfile CI installs first |
| `frontend/` | The React app. Own `package.json` + `package-lock.json`, `vite.config.ts` (port 1420), `tsconfig.json` extends the root `tsconfig.json` |
| `frontend/src/db/` | SQLite connection (`connection.ts`) + migrations (`migrations.ts`) |
| `src-tauri/` | Rust shell: `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, `src/` (lib, tray, commands), `icons/`, `app-icon.png` |
| `src-tauri/gen/android/` | Generated Gradle project (`npx tauri android init`) — **not committed yet**, see §9 |
| `server/` | FastAPI app: `__main__.py` (app + lifespan), `core.py`, `routes/`, `cache.py`, `sanitizers.py`, `state.py` |
| `venv/` | Python **3.11** virtualenv (gitignored) |
| `browser.json` | Live YouTube Music auth cookies — **gitignored, never commit** |
| `docs/plans/react-native-conversion.md` | Long-term conversion plan / spec (contains historical CI + DEVELOPMENT.md outlines) |
| `.github/workflows/` | `ci.yml`, `build-desktop.yml`, `build-android.yml` (see §10) |
| `AGENTS.md` | Agent-facing project notes (mirrors parts of this guide) |
| `bun.lock` | Bun is used at runtime by ytmusicapi for stream-signature decryption (see §2) |

---

## 2. Prerequisites

**Common (all platforms)**

| Tool | Version | Notes |
|---|---|---|
| Rust (rustup) | `stable` (≥ 1.77.2 per `Cargo.toml`) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | 20+ | CI pins Node 20 |
| npm | 10+ | Two lockfiles: root + `frontend/` — install **both** |
| Python | 3.11 **inside `./venv`** | The system `python3` may be 3.14 — **never** use it; always `./venv/bin/python` / `./venv/bin/pip` |
| Bun | **≤ 1.3.14** | ytmusicapi/yt-dlp shell out to a JS runtime to decrypt stream-URL signatures; Bun ≥ 1.3.15 is rejected. Current local version: 1.3.11 (`bun.lock`) |
| Git | any recent | Conventional commits, see §13 |

**Platform extras**

- **Linux (Debian/Ubuntu)** — Tauri system deps:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- **Windows** — "Desktop development with C++" Build Tools (Visual Studio), plus
  WebView2 Runtime (Windows 10 1803+ ships it; the bundle uses the
  download bootstrapper for installers). MSI builds additionally need the
  Windows "VBSCRIPT" optional feature enabled (see Tauri prerequisites).
- **macOS** — Xcode (or at least the Command Line Tools: `xcode-select --install`).

**Android (only for §9)**

| Tool | Version |
|---|---|
| JDK | 17 (Temurin) |
| Android SDK | command-line tools + platform-tools + platforms + build-tools (`ANDROID_HOME` set) |
| Android NDK | side-by-side install (`NDK_HOME` or newest under `$ANDROID_HOME/ndk`) |
| Rust targets | `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` |
| Gradle | wrapper ships inside the generated project — no global install |
| — | `cargo-ndk` is **not** required: the Gradle `rust` plugin invokes the Tauri CLI, which drives cargo + the NDK linkers itself |

---

## 3. Backend setup (`server/`)

```bash
# 1. virtualenv (only once; Python 3.11!)
python3.11 -m venv venv          # or: python3 -m venv venv if python3 IS 3.11
./venv/bin/pip install -r server/requirements.txt

# 2. auth cookies — copy a fresh capture into ./browser.json (repo root).
#    It is gitignored: NEVER commit it. (test.py / STUFF.md also contain the
#    same credentials — do not commit those either.)

# 3. Redis on localhost:6379 (default connection used by server/cache.py)
brew install redis && brew services start redis      # macOS
sudo apt install redis-server && sudo systemctl start redis-server   # Linux

# 4. run (from the repo root!)
./venv/bin/python -m server
```

- **Environment variables**
  - `PORT` — default `8000`
  - `BROWSER_PATH` — default `browser.json` (relative to the working directory)
  - Optional Telegram audio cache: `API_ID`, `API_HASH`, `BOT_TOKEN`, `TG_NAME`
    (skipped with a log line when unset)
- **Docs**: interactive Swagger at `http://localhost:8000/docs`, ReDoc at `/redoc`.
- **Startup side effects** (inside the FastAPI `lifespan`, never at import time):
  initializes the `YTMusic` client from `browser.json`, creates the Redis
  client, and regenerates `server/cookies.txt` from `browser.json`.
- **CI never runs the server.** Workflows only byte-compile and import it
  (see §10); starting it would require `browser.json` and Redis secrets the
  repo deliberately does not have.
- **Caching**: every route is `@sanitized` over `@cached` — if Redis is down
  the cache silently falls back to uncached answers, but you should still run
  Redis locally; re-reading `AGENTS.md`: it is listed as a startup
  requirement and speeds everything up.
- If pip results look stale, re-run the install: the venv can lag
  `requirements.txt`.

---

## 4. Frontend web development (`frontend/`)

```bash
# one-time: install BOTH lockfiles
npm ci
npm --prefix frontend ci

# start only the Vite dev server (no Tauri shell)
npm run dev:frontend        # = npm --prefix frontend run dev → vite
```

- Dev server: **http://localhost:1420** — `vite.config.ts` sets
  `port: 1420` with `strictPort: true` and `host: true` (LAN-accessible).
  1420 is the Tauri dev default and matches `devUrl` in
  `src-tauri/tauri.conf.json`.
- **API base URL**: `frontend/src/api.ts` reads
  `import.meta.env.VITE_API_BASE`, falling back to the hosted demo backend
  (`http://23.95.128.182:7181`) when unset. For the local backend create
  `frontend/.env.development`:
  ```bash
  echo 'VITE_API_BASE=http://localhost:8000' > frontend/.env.development
  ```
  (`.env.example` documents the variable; `.env.development` is not gitignored,
  so only commit URLs — no secrets.)
- **Routing uses `HashRouter`** (`frontend/src/App.tsx`). This is required:
  the app is also served from `tauri://` / `file://` origins where history
  routing breaks. Routes look like `http://localhost:1420/#/…`.
- Web-only features degrade outside Tauri: the SQLite layer
  (`frontend/src/db/`) reports `dbAvailable === false` when not running under
  Tauri, so library/offline features are shell-only.

---

## 5. Desktop development (`src-tauri/`)

```bash
npm run dev          # = tauri dev: starts Vite (beforeDevCommand), opens the app
```

Details of what that does:

- `npm run dev` runs the Tauri CLI with `src-tauri/tauri.conf.json`, which:
  - runs `beforeDevCommand: npm run dev:frontend` (Vite on :1420),
  - points the webview at `devUrl: http://localhost:1420`,
  - hot-reloads Rust on change.
- Equivalent explicit forms: `npm run tauri -- dev` or `npx tauri dev`
  (both from the repo root; the config is picked up automatically).
- `src-tauri/tauri.conf.json` — the knobs that matter:
  - `bundle.targets: "all"`, `identifier: com.samma3ni.carmen`
  - `beforeBuildCommand: npm run build:frontend`, `frontendDist: ../frontend/dist`
  - `app.security.assetProtocol.enable` + scope **`$APPDATA/**`** — the
    frontend can only stream assets from inside the app data dir
  - `app.security.csp` — no remote script origins; `img:`/`media:` allow
    `https:` + the asset protocol
- **Close-to-tray contract** (documented in `src-tauri/src/lib.rs`): closing
  the main window never quits — `CloseRequested` is intercepted, the window is
  hidden and audio keeps playing. **Quit only via the tray.**
- **Tray** (`src-tauri/src/tray.rs`): left click shows/focuses the window;
  right click opens the menu — *Open Carmen*, *Play / Pause* (label kept in
  sync by the frontend through `tray://state`), *Next track* (`tray://action`
  events), *Quit Carmen* (the only path that exits the process).
- **Commands**: `app_info` (name/version/platform/arch), `storage_paths`
  (below) and `battery_status` (charge level for the low-battery auto mode —
  `supported: false` where no backend exists, e.g. Android webviews, which
  report through `navigator.getBattery` instead) — everything else goes
  through the fs/sql/opener plugins, which are
  gated by `src-tauri/capabilities/default.json` (fs scope `$APPDATA/**`,
  opener limited to `http(s)://` URLs).
- **Where data lives** (per platform, all under the app-data dir):

  | OS | Path |
  |---|---|
  | Windows | `%APPDATA%\com.samma3ni.carmen\` |
  | macOS | `~/Library/Application Support/com.samma3ni.carmen/` |
  | Linux | `~/.local/share/com.samma3ni.carmen/` (or `$XDG_DATA_HOME/…`) |

  Contents: `songs/` (one folder per downloaded track), `artwork/` (cover art
  cache for OS media controls), `carmen.db` (SQLite, managed by
  `tauri-plugin-sql`). The frontend never hardcodes these — it calls
  `storage_paths` once at boot.

---

## 6. Database (SQLite via `tauri-plugin-sql`)

- Database name: `sqlite:carmen.db` (`frontend/src/db/connection.ts`) →
  `<app data>/carmen.db`. `PRAGMA foreign_keys = ON` is applied on open.
- One connection is opened during bootstrap (`frontend/src/main.tsx`) before
  React renders; migrations run at that point.
- Schema lives in **`frontend/src/db/migrations.ts`** — plain SQL entries in
  the `MIGRATIONS` array, applied in order by the runner in `connection.ts`
  and recorded in the `schema_migrations` table
  (`version`, `name`, `applied_at`).

**Tables** (migration v1): `tracks`, `downloads`, `playlists`,
`playlist_tracks`, `favorites`, `playback_state`, `feed_recent`,
`feed_suggestions`, `settings`, `app_state` — plus `schema_migrations`
created by the runner.

**Adding a migration**

1. Append a new object to `MIGRATIONS` with `version: <previous + 1>`, a
   `name`, and the `sql` for it. **Never edit an already-shipped migration** —
   the runner skips anything `<= max(version)` in `schema_migrations`.
2. Keep the SQL semicolon-free inside string literals: `splitStatements()`
   naively splits on `;` (documented in the file).
3. Run the app once and confirm the new row appears in `schema_migrations`.

---

## 7. TypeScript workflow

```bash
npm run typecheck     # = npm --prefix frontend run typecheck → tsc --noEmit
npm run build:frontend # = tsc --noEmit && vite build
```

- `frontend/tsconfig.json` extends the **root** `tsconfig.json`, which is
  `strict: true` + `noFallthroughCasesInSwitch`, `noImplicitOverride`,
  `forceConsistentCasingInFileNames`, `noEmit`, bundler module resolution.
- Deliberately relaxed for the current migration surface (see comments in the
  root tsconfig): `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, `verbatimModuleSyntax` are **off**; `allowJs` is off
  (the old JSX files are being replaced by TS).
- The root config's `include` is `frontend/src`, so the typecheck gate covers
  the app sources plus `vite.config.ts` (via the frontend config).
- Migration status is DB-side, not TS-side: query `schema_migrations` (or
  log it at boot) to see which SQL migrations are applied — see §6.
- There is no ESLint/Prettier config committed; formatting follows the
  surrounding file.

---

## 8. Building releases (desktop)

```bash
npm run build
# = npm run typecheck
#   && npm run build:frontend      (tsc + vite → frontend/dist)
#   && tauri build                 (Rust release + bundles)
```

Or stepwise:

```bash
npm run build:frontend        # frontend only (this is the CI gate)
npm run tauri -- build        # full bundle; add -- --debug for a debug bundle
npx tauri build               # equivalent, bypasses the npm script
```

- Bundles produced (`bundle.targets: "all"`):
  - **Windows**: `.msi` + NSIS `setup.exe`
  - **macOS**: `.app` + `.dmg`
  - **Linux**: `.deb`, `.rpm`, `.AppImage`
- **Icons**: `npm run icons` = `tauri icon src-tauri/app-icon.png` —
  regenerates everything under `src-tauri/icons/` (32/128/256 PNGs, `icon.icns`,
  `icon.ico`, Android mipmaps, iOS icons) from the single square source
  `src-tauri/app-icon.png`. The `bundle.icon` list in `tauri.conf.json`
  references those exact filenames.
  ⚠️ `.gitignore` contains `src-tauri/icons` — already-tracked icon files
  still show modifications, but **newly generated files need `git add -f`**.
- Code signing/notarization is **not configured yet** (no
  `TAURI_SIGNING_PRIVATE_KEY`, no Apple identity, no Windows cert) — local and
  CI bundles are unsigned (macOS gets ad-hoc signing only).

---

## 9. Android

**One-time setup** (see §2 for versions):

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi \
  i686-linux-android x86_64-linux-android
export ANDROID_HOME="$HOME/Android/Sdk"        # or your SDK path
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 "$ANDROID_HOME/ndk" | sort -V | tail -1)"

npm run android:init        # = tauri android init → creates src-tauri/gen/android/
```

- `src-tauri/gen/android/` is generated, **not committed yet**. CI generates it
  when missing (`.github/workflows/build-android.yml`). Recommended: generate
  it once locally, apply the signing config below, and commit it (the template
  ships a `.gitignore` that already excludes `keystore.properties` and
  `local.properties`).
- Init reads the app name/identifier from `src-tauri/tauri.conf.json`
  (`Carmen` / `com.samma3ni.carmen`).

**Signing key (Play Store upload key)**

```bash
keytool -genkey -v -keystore ~/upload-keystore.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias upload
base64 -i ~/upload-keystore.jks            # → secret ANDROID_KEYSTORE_BASE64
# (on Linux: base64 -w0 ~/upload-keystore.jks)
```

Keep the `.jks` private and out of git.

**Wiring the keystore** — per the official Tauri docs
(<https://v2.tauri.app/distribute/sign/android/>), two things are needed in
`src-tauri/gen/android/`:

1. `keystore.properties` (gitignored):
   ```properties
   keyAlias=upload
   password=<store password>
   keyPassword=<key password, optional — defaults to password>
   storeFile=/absolute/path/to/upload-keystore.jks
   ```
2. A `release` signing config in `app/build.gradle.kts` (the generated
   template ships **without** one):
   ```kotlin
   import java.io.FileInputStream   // add at the top, next to java.util.Properties

   android {
       signingConfigs {
           create("release") {
               val keystorePropertiesFile = rootProject.file("keystore.properties")
               val keystoreProperties = Properties()
               if (keystorePropertiesFile.exists()) {
                   keystoreProperties.load(FileInputStream(keystorePropertiesFile))
               }
               keyAlias = keystoreProperties["keyAlias"] as String
               keyPassword = (keystoreProperties["keyPassword"] ?: keystoreProperties["password"]) as String
               storeFile = file(keystoreProperties["storeFile"] as String)
               storePassword = keystoreProperties["password"] as String
           }
       }
       buildTypes {
           getByName("release") {
               signingConfig = signingConfigs.getByName("release")
               // …
           }
       }
   }
   ```
   The CI workflow applies exactly this patch idempotently (it skips the step
   when `keystore.properties` is already referenced), so you only need to do
   it by hand for local release builds.

**Build**

```bash
npx tauri android build --release
# builds BOTH an APK and an AAB by default; be explicit if you want one:
npx tauri android build --release --apk        # APK only
npx tauri android build --release --aab        # AAB only
npx tauri android build --release --split-per-abi   # per-ABI APKs/AABs
```

- `--apk` / `--aab` are **Tauri CLI flags**, not Gradle passthrough.
  Anything after a bare `--` goes to the runner/Gradle instead.
- Outputs (flavor directories from the `rust` Gradle plugin):
  - APK: `src-tauri/gen/android/app/build/outputs/apk/<flavor>/release/*.apk`
  - AAB: `src-tauri/gen/android/app/build/outputs/bundle/<flavor>Release/*.aab`
- The first build compiles Rust for four Android targets — expect minutes, not
  seconds (release uses LTO + `codegen-units = 1`).

**Deploy / test**

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
# or the debug build during development:
npx tauri android dev        # requires a device/emulator (adb devices)
```

---

## 10. CI/CD (GitHub Actions)

Three workflows live in `.github/workflows/`:

| Workflow | Triggers | What it does |
|---|---|---|
| `ci.yml` | push to `main`/`master`, PRs | 3 jobs: **frontend** (`npm ci` both lockfiles → `npm run typecheck` → `npm run build:frontend`), **rust** (Linux webkit deps → `cargo check` in `src-tauri`), **server** (fresh Py3.11 venv → `pip install -r server/requirements.txt` → `python -m compileall server` → `import server.__main__`). Read-only permissions; **never starts the server** — the import is safe because `YTMusic`/Redis/browser.json are all created inside the FastAPI `lifespan`, which a plain import never runs. |
| `build-desktop.yml` | tags `v*`, `workflow_dispatch` | Matrix `windows-latest` / `macos-latest` / `ubuntu-latest`: Node 20 + Rust stable + rust-cache, frontend+root `npm ci`, then `tauri-apps/tauri-action@v0` builds the bundles (`bundle.targets: "all"`), uploads each as a workflow artifact. A single `release` job (tags only) downloads all artifacts and attaches them to a GitHub Release via `softprops/action-gh-release@v2` — one job, so three matrix runners never race to create the release. |
| `build-android.yml` | tags `v*`, `workflow_dispatch` | Ubuntu + Temurin JDK 17 + Android SDK/NDK + Rust Android targets: generates `src-tauri/gen/android` **only if missing** (`npx tauri android init --ci`), decodes the keystore + writes `keystore.properties` + patches the release signing config **when secrets exist** (otherwise builds unsigned), runs `npx tauri android build --release --ci --apk --aab`, uploads `.apk`/`.aab` as artifacts, and attaches them to the GitHub Release on tags. |

Common properties: pinned major action versions (`checkout@v4`,
`setup-node@v4`, `setup-java@v4`, `setup-python@v5`, `upload/download-artifact@v4`,
`dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`,
`android-actions/setup-android@v3`, `tauri-action@v0`,
`softprops/action-gh-release@v2`), a `concurrency` group per workflow/ref
that cancels superseded runs, and `permissions: contents: write` **only** on
the two release jobs — everything else is `contents: read`.

**Repo note**: the root `package-lock.json` currently exists only in the
working tree (untracked). The workflows run `npm ci` when it is present and
fall back to `npm install` when it is not; **commit it** to make every CI
install fully lockfile-pinned (`frontend/package-lock.json` is tracked, so
the frontend always uses `npm ci`).

**Release flow**: bump versions (`package.json` + `src-tauri/tauri.conf.json`
+ `Cargo.toml`) → commit → `git tag v1.2.0 && git push origin v1.2.0` →
both release workflows run → GitHub Release is created/updated with the
desktop bundles (dmg/msi/exe/deb/rpm/AppImage) and the Android APK/AAB.

**Required GitHub secrets**

| Secret | Required for | Notes |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | signed Android builds | `base64 -w0 upload-keystore.jks` (Linux) / `base64 -i …` (macOS). When unset the Android job **builds unsigned** and says so via a notice |
| `ANDROID_KEYSTORE_PASSWORD` | ″ | keystore (`-storepass`) password → `password=` in `keystore.properties` |
| `ANDROID_KEYSTORE_ALIAS` | ″ | keytool alias (`upload`) → `keyAlias=` |
| `ANDROID_KEY_PASSWORD` | optional | `-keypass`; falls back to the store password when omitted |
| `GITHUB_TOKEN` | releases | Provided automatically by Actions; the release jobs declare `permissions: contents: write` for it |

No secrets are needed for `ci.yml` or for the desktop bundles (unsigned).
There is no test suite in CI — see §11.

---

## 11. Testing policy

- **No E2E/browser test tooling** — no Playwright/Selenium/Cypress anywhere,
  and none may be added as part of the current work. The webview shell cannot
  be meaningfully driven by those tools anyway.
- **No unit-test runner** is wired up yet (`frontend` has no `test` script;
  server has no pytest suite). ruff has been run ad hoc on `server/` but there
  is no pinned config.
- **Verification = the CI gates + a manual smoke pass:**
  ```bash
  npm run typecheck            # 0 errors
  npm run build:frontend       # vite build succeeds → frontend/dist
  cd src-tauri && cargo check  # Rust compiles
  ./venv/bin/python -m compileall server && ./venv/bin/python -c "import server.__main__"
  ```
  then, for anything touching runtime behaviour, run the app and check:
  - [ ] close the window → tray icon → audio keeps playing → *Open Carmen* returns to the same route
  - [ ] restart the app → queue + position restored (`playback_state`), press play resumes
  - [ ] download a song → plays offline (airplane mode), artwork/title from local files
  - [ ] create/add/favorite a playlist → survives restart (`playlists`/`playlist_tracks`/`favorites`)
  - [ ] a lyrics-provider setting persists and changes the lyrics source
  - [ ] battery under 20% **unplugged** → low battery mode turns itself on
        (white accent, no blur, Settings status line says *On automatically*)
        → plug in → effects return; the manual toggle survives restart
- `AGENTS.md` still holds: verify changes by **running the server**, not via
  JS/TS tooling, when the change is server-side.

---

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Stream URLs fail, ytmusicapi/yt-dlp errors about a JS runtime | **Bun too new** — must be **≤ 1.3.14** (`bun --version`; downgrade with `bun install -g bun@1.3.11`). Note `server/core.py` `streaming_options` also prefers `deno` as a `js_runtimes` entry |
| `redis.exceptions.ConnectionError`, cache never hits | **Redis not running** — start it on `localhost:6379`. Routes still answer (the `@cached` decorator falls back to uncached), but everything re-fetches |
| 401s / empty taste profile / `browser.json` load errors | **Stale `browser.json` cookies** — recapture the YouTube Music cookies from a logged-in browser (see `STUFF.md` for the conversion notes; never commit it) |
| `cargo` network timeouts, `error: failed to fetch` | crates.io flakiness — retry, or `export CARGO_HTTP_TIMEOUT=120 CARGO_NET_RETRY=5`; CI uses `Swatinem/rust-cache@v2`, locally just re-run. Sparse-index hiccups clear on re-run |
| Linux: `webkit2gtk-4.1 not found`, `libayatana-appindicator` errors | Install the apt package list from §2 — required for **both** `tauri dev` and `cargo check` |
| Windows: blank window / "WebView2 required" | Install the WebView2 Runtime (evergreen bootstrapper); VS Build Tools needed to compile |
| macOS: `xcrun: error: invalid active developer path` | `xcode-select --install` |
| `vite errored ... port 1420 in use` / `strictPort` failure | Port **1420** is taken — kill the previous `npm run dev`/`tauri dev`, or another dev server. `strictPort: true` makes Vite refuse to move ports because `devUrl` expects 1420 |
| `asset protocol ... not allowed` / `fs ... not authorized`, artwork/audio fails to load | The file is outside the **`$APPDATA/**` scope** (`tauri.conf.json` → `assetProtocol.scope`, `capabilities/default.json` → `fs:scope`). Move data under the app-data dir or extend the scope deliberately (it is a security boundary) |
| `npm run build` unexpectedly takes forever / runs `tauri build` | Root `build` = `typecheck && build:frontend && tauri build`. Use `npm run build:frontend` for the web bundle alone |
| Android: `Failed to find package "ndk;…"` or `NDK not found` | Install the NDK via SDK Manager and export `NDK_HOME` (§9); CI pins one in the workflow |
| Android: CI signing step fails with "anchor … not found" | The Tauri template changed — update the patch anchors in `build-android.yml` (the error names the missing anchor) |
| `permission denied` writing `server/cookies.txt` | Server startup regenerates it from `browser.json`; run from the repo root with write access |
| Ruff/PyYAML noise | `.ruff_cache` exists from ad-hoc runs; there is no pinned linter config to satisfy |

---

## 13. Commits & contribution checklist

Commit style follows **Conventional Commits** (see `git log`):

```text
feat(core): richer track payload with lyrics provider
fix(stream): stamp CORS headers so a cached song still downloads
refactor(QueuePage): reorder imports and simplify now playing text
docs(plan): add task 4b for native platform shell generation
ci(android): signed release apk and aab with keystore secrets
chore: …
```

Format: `type(scope): lowercase summary` — scopes used so far include
`core`, `sanitizers`, `stream`, `server`, `frontend`, `player`, `lyrics`,
`theme`, `downloads`, `android`, `plan`. `ci:` and `chore:` for workflow /
tooling changes.

**Before you commit**

1. `git status` — never stage `browser.json`, `venv/`, `test.py`,
   `server/.audio_cache/`, `*.jks`, `keystore.properties` (all gitignored;
   double-check anyway).
2. `npm run typecheck` → 0 errors.
3. `npm run build:frontend` → succeeds (or full `npm run build` if you changed
   Rust/config too; `cargo check -p`-style checks live in `src-tauri`).
4. Server change? `./venv/bin/python -m compileall server` +
   `./venv/bin/python -c "import server.__main__"` and a manual smoke run
   (`./venv/bin/python -m server` with Redis + `browser.json`).
5. Follow the **read-only boundaries** documented in `AGENTS.md` when working
   in parallel (frontend migration work must not touch `server/`,
   `src-tauri/`, or the root configs unless that is the task).
6. `git add <files> && git commit -m "type(scope): summary"` — do not push
   unless you intend to trigger `ci.yml`.
