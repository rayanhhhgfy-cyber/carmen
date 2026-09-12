# AGENTS.md

## Project overview
FastAPI backend (`server/`) wrapping `ytmusicapi` to expose YouTube Music endpoints (browsing, search, watch, playlists, podcasts). Despite `package.json`/`README.md` being leftover from `bun init`, there is **no TS app and no `index.ts`** — ignore `bun run index.ts`. Bun is only used at runtime by ytmusicapi as a JS runtime for stream-URL signature decryption.

## Run the server
```bash
./venv/bin/python -m server   # from repo root; Python 3.11 venv
```
- Env: `PORT` (default 8000), `BROWSER_PATH` (default `./browser.json`).
- Startup requirements: `browser.json` (live authenticated YouTube Music cookies, gitignored) and a local Redis on localhost:6379.
- Install: `./venv/bin/pip install -r server/requirements.txt`. Always use `venv/` — system `python3` is 3.14; the venv is 3.11.
- Interactive docs at `/docs`, `/redoc`.

## Architecture
- `server/core.py`: thin sync wrappers around a single global `YTMusic` client created by `init_ytm()`. The `options` dict near the top is currently **unused** — `init_ytm` calls `YTMusic(str(browser))` directly; don't assume those options are active.
- `server/routes/*.py`: FastAPI routers (browsing, search, watch, podcasts, playlists), aggregated in `server/routes/__init__.py`. All `ytmusicapi` calls are blocking and run in a shared 8-thread `ThreadPoolExecutor` (`server/state.py`) via `loop.run_in_executor`.
- Every route uses two decorators, **in this exact outer→inner order**: `@sanitized` then `@cached("<prefix>", ttl=...)`:
  - `@sanitized` (`sanitizers.py`) strips feedback/tracking tokens and streaming URLs (`googlevideo.com`, `videoplayback`) from responses. Stream URLs are intentionally never exposed through the API — don't bypass this.
  - `@cached` (`cache.py`) JSON-caches results in Redis under `yt:{prefix}:{sha256}` and silently falls back to uncached on Redis errors.
- New routes must follow the pattern: a `partial` of the sync core function run through the executor, decorated `@sanitized` above `@cached`.

## Gotchas
- `browser.json` contains real auth cookies / SAPISID tokens — gitignored, never commit. `test.py` and `STUFF.md` hold the same credentials and scratch notes (cookie conversion, yt-dlp commands).
- Bun must stay ≤ **1.3.14** (yt-dlp/ytmusicapi rejects newer versions); current is 1.3.11.
- "Taste profile" and library-scoped endpoints require the authenticated cookies in `browser.json`.
- No test suite, no CI, no pinned linter config (ruff has been run ad hoc — `.ruff_cache` exists but no config file). Verify changes by running the server, not via JS/TS tooling.
- The installed venv can lag `requirements.txt` (e.g. `yt-dlp` is in requirements but not yet installed in `venv/`).
- Commit style follows conventional commits: `feat(core): …`, `feat(sanitizers): …` (see git log).