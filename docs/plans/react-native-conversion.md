# Samma3ni (Carmen) → React Native Cross-Platform Conversion — Implementation Plan

> **STATUS — SUPERSEDED (2026-10-08). Do not execute this plan.** The project pivoted to a **Tauri v2 + React + TypeScript** implementation (see `src-tauri/`, the TS migration of `frontend/`, and `DEVELOPMENT.md`), which delivers the same specification. The RN work completed here (Tasks 1–4B: scaffold, fonts/icons, api utils, theme provider, native shells) lives on branch **`rn-work`**, and `app/` was removed in `9fe8e69`. Kept for historical reference only.

> **For agentic workers:** Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing Vite/React web audio frontend (`frontend/`) into a TypeScript React Native application shipping on Android, Windows, macOS and Linux — with close-to-tray background playback, a redesigned Now Playing experience, fully offline downloads (raw audio + synced lyrics + artwork, no ffmpeg/tagging), an embedded SQLite database for playlists/favorites/playback-state, a 4-section Library view, a Lyrics Provider setting, GitHub Actions builds for all four platforms, and a step-by-step `DEVELOPMENT.md`.

**Architecture:** One shared RN+TS codebase in `app/` targeting four native shells: Android (RN core + Media3), Windows (react-native-windows + WinRT MediaPlayer/SMTC), macOS (react-native-macos + AVPlayer/MPNowPlayingInfo), Linux (react-native-linux GTK4 + GStreamer/MPRIS). All platform-specific capability is isolated behind four local TurboModule bridge packages (`samma3ni-db`, `samma3ni-fs`, `samma3ni-audio`, `samma3ni-tray`) with one TypeScript facade each; above those facades everything (state, repositories, services, UI) is pure portable TS. State is Zustand; persistence is SQLite through a driver interface that swaps to an in-memory sql.js driver under Jest.

**Tech Stack:** React Native 0.83.10 + TypeScript 5, react-native-windows 0.83.2, react-native-macos 0.83.0, @lucid-softworks/react-native-linux (GTK4, pinned commit), Zustand 5, SQLite (native per platform; sql.js for tests), Jest + `tsc --noEmit` as the verification gate (**no browser/E2E tooling of any kind — Playwright/Selenium/Cypress are explicitly out of scope per requirements**).

---

## Scope check (per writing-plans skill)

This spec spans nine subsystems (scaffold, native bridges, offline storage, database, playback engine, tray/window, UI redesign, library, CI/CD, docs). It is delivered as **one plan with ten phases**, each phase independently buildable and testable and ending in a commit, so work can stop at any phase boundary with a coherent app. If you prefer to split further, phase boundaries are the natural cut lines (one sub-plan per phase).

## Context — behavioral spec of the existing web app (source of truth for ports)

* **Stack:** `frontend/` = Vite + React 18 + MUI + react-router. Left untouched by this conversion (legacy web target).
* **API client** (`frontend/src/api.js`): `API_BASE = VITE_API_BASE || 'http://23.95.128.182:7181'`; `apiGet(path, params, signal)`; `streamUrl(videoId) = {API_BASE}/stream?vidId=…`.
* **Endpoints used:** `GET /search?query&filter&limit`, `GET /search/suggestions?query`, `GET /browsing/track/{videoId}` (enriched: metadata + `lyrics {synced[{timeMs,text}], unsynced, source}`), `GET /browsing/related/{videoId}?limit`, `GET /browsing/album/{id}`, `GET /playlists/{id}?limit`, `GET /stream?vidId=`, `GET /stream/status?vidId=`.
* **Routes:** `/` Home (personal feed from local library only — no backend home call), `/search`, `/queue`, `/settings`, `/collection/:kind/:id`.
* **Player state** (`player/PlayerContext.jsx`): `current, meta, queue, history(100), related, relatedFor, isPlaying, buffering, error, currentTime, duration, buffered, shuffle, repeat('off'|'all'|'one'), sheetOpen`; actions `playTrack, playAll, addToQueue, playNext, removeFromQueue, clearQueue, togglePlay, next, previous, seek, toggleShuffle, cycleRepeat, waitForCache`; auto-continue from `related` when the queue runs out; `previous` restarts if >3s in.
* **Downloads (to be rewritten):** web pipeline fetches `/stream` → ffmpeg.wasm MP3 transcode → `browser-id3-writer` ID3 tags → browser save. **Both dependencies and the conversion/tagging steps are removed** in the RN app; replaced by raw audio + `.lrc` + JPEG artwork written to sandbox storage + a `downloads` row. `waitForCache` (poll `/stream/status`, bounded) is kept.
* **Lyrics:** `utils/lyrics.js` — `toLrc(lines)`, `syncedLines(meta)`, `plainLyrics(meta)`; active line follows the clock, tap-to-seek, colour-only highlight.
* **Local feed (localStorage):** `carmen.recent.v1` (last 10 plays), `carmen.suggestions.v1` (≤100, batch of 10 related per play) → move to SQLite tables.
* **Theme:** localStorage `carmen:themeMode|carmen:accent|carmen:adaptiveAccent|carmen:font.v2`; 12 accents (default `#4CAF50`); fonts Alexandria (project default) / Cairo / system; dark bg `#0a0d0b`, paper `#121714`, text `#f1f4f2`; light bg `#f6f7f6`, paper `#ffffff`, text `#12160f`; radius 14; adaptive accent = dominant colour of the playing cover.
* **Server (FastAPI):** `server/core.py get_track()` builds metadata + `_collect_lyrics()` (YouTube timed → `ytm.get_lyrics` plain → `syncedlyrics.search()` public providers). Stream format is `bestaudio[ext=m4a]/bestaudio/best` via yt-dlp with **no ffmpeg post-processing** (nothing to strip server-side; verified by grep). `syncedlyrics.search(term, providers=[...])` supports provider selection: `Musixmatch, Lrclib, NetEase, Megalobiz, Genius`. `@cached` hashes all route args, so adding a query param automatically namespaces the cache key.

## Key architectural decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| RN version | **0.83.10** (react 19.2.x) | Highest version supported by *all* of RN core, react-native-windows (0.83.2), react-native-macos (0.83.0); lucid rn-linux supports ≥0.81 |
| Repo layout | New **`app/`** directory | Existing `frontend/` stays untouched (user decision) |
| Database | **Own `samma3ni-db` TurboModule** over each OS's bundled SQLite + sql.js driver under Jest | One uniform sync/async contract across 4 platforms; `react-native-quick-sqlite` and WatermelonDB have no desktop support (user chose SQLite) |
| Desktop runtime | Pure RN native: RNW + rn-macos + rn-linux GTK4 | User decision (spec-literal); Linux platform is alpha — mitigated by CI-first verification and a fallback note |
| Audio | Own `samma3ni-audio` TurboModule on all 4 platforms (single-source engine; JS store owns queue/shuffle/repeat/history) | RNTP supports Android/iOS only; a uniform single-track engine keeps queue semantics identical everywhere and drives native MediaSession/SMTC/MPNowPlayingInfo/MPRIS |
| Tray/close | Own `samma3ni-tray` TurboModule (Win32 `Shell_NotifyIcon`, AppKit `NSStatusItem`, StatusNotifierItem over GDBus for GTK4); close ⇒ hide, quit only via tray menu | No maintained cross-platform RN tray lib; GTK4 removed `GtkStatusIcon`, so SNI/dbusmenu is implemented directly |
| Navigation | Custom lightweight nav store (6 routes) | Avoids react-navigation's native deps (`react-native-screens`, gesture-handler, safe-area) that are unsupported/fragile on RNW/macOS/GTK-alpha; exact route-stack serialization is a requirement anyway |
| Icons | Bundled `MaterialIcons-Regular.ttf` rendered through `<Text>` | No SVG native dependency (`react-native-svg` has no Windows/Linux support); works on all four platforms |
| Fonts | Alexandria + Cairo static TTFs committed in `app/assets/fonts/` and linked into every package | 100 % offline requirement; copied from `@expo-google-fonts/*` + `react-native-vector-icons` packages |
| Animations | RN core `Animated` only (JS driver + native driver where supported) | `react-native-reanimated` has no RNW/macOS/Linux support |
| Tests | Jest (pure TS + repos via sql.js driver) + `tsc --noEmit` + Metro bundle check per platform | **No browser testing of any kind** (requirement) |

## File map

```
app/                                    NEW — React Native app (TypeScript)
├── package.json                        RN 0.83.10, scripts: test, typecheck, bundle:*
├── tsconfig.json  babel.config.js  metro.config.js  jest.config.js
├── react-native.config.js              assets: ['./assets/fonts']; platform registration
├── index.js  App.tsx
├── assets/
│   ├── fonts/                          Alexandria_400…800, Cairo_400…800, MaterialIcons-Regular
│   └── tray.png                        tray icon (macOS template @2x/@3x)
├── env.example.json                    optional API base override (env.json gitignored)
├── scripts/
│   ├── copy-fonts.mjs                  one-shot: copy TTFs from node_modules → assets/fonts
│   └── setup-linux.sh                  fetch pinned rn-linux template into app/linux (or CI)
├── src/
│   ├── config.ts                       API_BASE, brand constants
│   ├── native/                         ← thin facades over TurboModules (ONLY place NativeModules appears)
│   │   ├── db.ts  fs.ts  audio.ts  tray.ts  window.ts
│   ├── db/
│   │   ├── driver.ts                   DbDriver interface + getDriver() (native | sql.js)
│   │   ├── database.ts                 open + migration runner
│   │   ├── migrations.ts               versioned SQL (v1 … )
│   │   └── repos/                      settings.ts playback.ts playlists.ts favorites.ts
│   │                                   tracks.ts downloads.ts feed.ts appState.ts
│   ├── state/
│   │   ├── playerStore.ts              queue/current/time/shuffle/repeat + persistence
│   │   ├── downloadsStore.ts           job progress observable
│   │   ├── libraryStore.ts             playlists/favorites/songs views (zustand)
│   │   ├── settingsStore.ts            theme + lyricsProvider (persisted via settingsRepo)
│   │   └── navStore.ts                 route stack + persistence (route restore)
│   ├── services/
│   │   ├── api.ts                      port of api.js (fetch based, RN safe)
│   │   ├── downloadService.ts          raw audio + artwork + .lrc → sandbox → downloadsRepo
│   │   ├── playbackService.ts          hydrate queue on boot, engine ↔ store glue, media controls
│   │   ├── lyricsService.ts            toLrc/parseLrc/synced/plain + offline .lrc read
│   │   ├── desktopLifecycle.ts         close→flush→tray, restore-on-show, quit
│   │   └── snackbars.ts                notice observable (port of downloads notices)
│   ├── navigation/
│   │   ├── types.ts  Router.tsx        route map, stack transitions with Animated
│   ├── screens/
│   │   ├── HomeScreen.tsx  SearchScreen.tsx  QueueScreen.tsx  SettingsScreen.tsx
│   │   ├── CollectionScreen.tsx
│   │   ├── LibraryScreen.tsx           4 sections: Playlists / Songs / Albums&Artists / Recent
│   │   └── NowPlayingScreen.tsx        redesigned player (desktop 2-pane / mobile stacked)
│   ├── components/
│   │   ├── Icon.tsx  Artwork.tsx  MiniPlayer.tsx  AmbientBackground.tsx
│   │   ├── TrackRow.tsx  TrackList.tsx  MediaCard.tsx  CardGrid.tsx  EmptyState.tsx
│   │   ├── PlayerControls.tsx  SeekBar.tsx  LyricsPanel.tsx  QueuePanel.tsx  RelatedPanel.tsx
│   │   ├── SortMenu.tsx  PlaylistPickerDialog.tsx  ConfirmDialog.tsx  Snackbar.tsx
│   │   └── AppShell.tsx                side nav (desktop) / bottom tabs (mobile) + top bar
│   ├── theme/
│   │   ├── tokens.ts  ThemeProvider.tsx  adaptiveAccent.ts
│   ├── utils/                          format.ts track.ts artwork.ts color.ts
│   └── __tests__/ …                    jest tests colocated as *.test.ts
├── modules/                             ← local TurboModule packages (autolinked)
│   ├── samma3ni-db/                     package.json+codegen, spec/NativeSamma3niDb.ts,
│   │                                   android/(Kotlin) macos/ windows/ linux/ (C++)
│   ├── samma3ni-fs/                     same shape: paths/write/read/download/exists/…
│   ├── samma3ni-audio/                  load/play/pause/seek/setMetadata + events
│   └── samma3ni-tray/                   desktop only: tray menu + close-to-tray + window show/hide
├── android/                             RN 0.83 template + permissions + signing props + assets/fonts
├── windows/                             rn-windows init (C++/WinRT), close intercept + tray glue
├── macos/                               rn-macos init, windowShouldClose → hide, NSStatusItem
└── linux/                               generated from pinned @lucid-softworks template (CMake/GTK4)

server/
├── core.py                              MODIFY: get_track(provider=…), _collect_lyrics(provider=…)
└── routes/browsing.py                   MODIFY: track route accepts ?provider=

.github/workflows/
├── ci.yml                               tsc + jest + metro bundles (4 platforms)
├── android.yml                          assembleRelease (.apk) + bundleRelease (.aab), keystore signing
├── windows.yml                          MSBuild Release → msix/appx artifact
├── macos.yml                            xcodebuild archive → .app/.pkg artifact
└── linux.yml                            GTK4/CMake build → .deb + tar.gz artifacts

DEVELOPMENT.md                           NEW (repo root) — setup, run, build per platform
docs/plans/react-native-conversion.md    this plan
```

---

## Phase 0 — Scaffold & offline assets

### Task 1: `app/` React Native + TypeScript skeleton

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/babel.config.js`, `app/metro.config.js`, `app/jest.config.js`, `app/react-native.config.js`, `app/index.js`, `app/App.tsx`, `app/.gitignore`

- [ ] **Step 1: Create the package with pinned versions**

`app/package.json`:

```json
{
  "name": "carmen",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "react-native start",
    "android": "react-native run-android",
    "windows": "react-native run-windows",
    "macos": "react-native run-macos",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "bundle:android": "react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/bundle.android.js",
    "bundle:ios": "react-native bundle --platform ios --dev false --entry-file index.js --bundle-output /tmp/bundle.ios.js",
    "bundle:windows": "react-native bundle --platform windows --dev false --entry-file index.js --bundle-output /tmp/bundle.windows.js",
    "bundle:macos": "react-native bundle --platform macos --dev false --entry-file index.js --bundle-output /tmp/bundle.macos.js",
    "bundle:linux": "react-native bundle --platform linux --dev false --entry-file index.js --bundle-output /tmp/bundle.linux.js"
  },
  "dependencies": {
    "react": "19.2.0",
    "react-native": "0.83.10",
    "zustand": "^5.0.15",
    "jpeg-js": "^0.4.4",
    "fast-png": "^6.2.0"
  },
  "devDependencies": {
    "@babel/core": "^7.25.0",
    "@babel/preset-env": "^7.25.0",
    "@babel/runtime": "^7.25.0",
    "@react-native/babel-preset": "0.83.10",
    "@react-native/metro-config": "0.83.10",
    "@react-native/typescript-config": "0.83.10",
    "@types/react": "^19.1.0",
    "@types/react-test-renderer": "^19.1.0",
    "jest": "^29.7.0",
    "react-test-renderer": "19.2.0",
    "sql.js": "^1.11.0",
    "@types/sql.js": "^1.4.9",
    "typescript": "^5.6.0"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Config files**

`app/tsconfig.json`:

```json
{
  "extends": "@react-native/typescript-config/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "moduleResolution": "node",
    "skipLibCheck": true,
    "types": ["jest"]
  },
  "include": ["src/**/*", "modules/**/spec/**/*", "App.tsx", "index.js"],
  "exclude": ["node_modules", "**/android/**", "**/windows/**", "**/macos/**", "**/linux/**"]
}
```

`app/babel.config.js`:

```js
module.exports = { presets: ['@react-native/babel-preset'] };
```

`app/jest.config.js`:

```js
module.exports = {
  preset: 'react-native',
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|sql\\.js)/)',
  ],
  moduleNameMapper: {
    // native facades resolve to mockable test drivers under Jest
    '^\\.\\.?/.*/native/db$': '<rootDir>/src/test/mocks/dbDriver.ts',
    '^\\.\\.?/.*/native/fs$': '<rootDir>/src/test/mocks/fsDriver.ts',
    '^\\.\\.?/.*/native/audio$': '<rootDir>/src/test/mocks/audioDriver.ts',
    '^\\.\\.?/.*/native/tray$': '<rootDir>/src/test/mocks/trayDriver.ts',
  },
};
```

`app/react-native.config.js`:

```js
const path = require('path');
module.exports = {
  project: { ios: {}, macos: {}, windows: {}, android: {} },
  assets: [path.join(__dirname, 'assets', 'fonts')],
  // local TurboModule packages (autolinking)
  dependencies: Object.fromEntries(
    ['samma3ni-db', 'samma3ni-fs', 'samma3ni-audio', 'samma3ni-tray'].map((name) => [
      name,
      { root: path.join(__dirname, 'modules', name) },
    ]),
  ),
};
```

`app/index.js`:

```js
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
AppRegistry.registerComponent(appName, () => App);
```

`app/App.tsx` (temporary hello, replaced in Task 18):

```tsx
import React from 'react';
import { Text, View } from 'react-native';

export default function App(): React.JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Carmen</Text>
    </View>
  );
}
```

Also create `app/app.json` `{"name": "Carmen", "displayName": "Carmen"}` and `app/.gitignore` (`node_modules/`, `env.json`, `.gradle/`, `build/`, `Pods/`, `*.hbc`, `msbuild.binlog`).

- [ ] **Step 3: Install and verify toolchain**

```bash
cd app && npm install
npm run typecheck && npm test
```
Expected: 0 type errors, jest reports "no tests found" (ok at this stage — Task 3 adds tests).

- [ ] **Step 4: Commit**

```bash
git add app/ && git commit -m "feat(app): react-native + typescript scaffold for four platforms"
```

---

### Task 2: Bundle fonts & icons (100 % offline) and theme tokens

**Files:**
- Create: `app/scripts/copy-fonts.mjs`, `app/assets/fonts/*.ttf`, `app/src/components/Icon.tsx`, `app/src/theme/tokens.ts`, `app/src/utils/glyphs.ts`

- [ ] **Step 1: Add font sources as devDependencies**

```bash
cd app && npm install -D @expo-google-fonts/alexandria @expo-google-fonts/cairo react-native-vector-icons
```

- [ ] **Step 2: Copy TTFs into the package (committed)**

`app/scripts/copy-fonts.mjs` copies:
- `node_modules/@expo-google-fonts/alexandria/Alexandria_*.ttf` — glob `Alexandria_{400Regular,500Medium,600SemiBold,700Bold,800ExtraBold}.ttf` (verify actual filenames with `ls` after install; glob and warn on missing weights rather than hard-fail)
- `node_modules/@expo-google-fonts/cairo/Cairo_400Regular.ttf` … `_800ExtraBold`
- `node_modules/react-native-vector-icons/Fonts/MaterialIcons.ttf` → `assets/fonts/MaterialIcons.ttf`

```bash
node scripts/copy-fonts.mjs && ls assets/fonts   # expect 11 TTFs, committed to git
```

(`@expo-google-fonts/*` ships static, full-charset TTFs — Latin **and** Arabic — exactly what Alexandria/Cairo need; no `expo` runtime dependency is introduced because we link the raw files.)

- [ ] **Step 3: Icon component over the bundled font**

`app/src/utils/glyphs.ts` — vendored subset of `react-native-vector-icons/glyphmaps/MaterialIcons.json` (keep only the codepoints the app uses; the generator script below keeps it honest):

```ts
/** Codepoints of MaterialIcons.ttf actually used by the app. */
export const GLYPHS = {
  home: 'e88a', search: 'e8b6', queueMusic: 'e03f', settings: 'e8b8',
  play: 'e037', pause: 'e034', skipNext: 'e044', skipPrevious: 'e045',
  shuffle: 'e043', repeat: 'e040', repeatOne: 'e041', favorite: 'e87d',
  favoriteBorder: 'e87e', download: 'e2c0', lyrics: 'e0c9', libraryMusic: 'e030',
  album: 'e019', person: 'e7ef', close: 'e5cd', arrowBack: 'e5c4',
  moreVert: 'e5d4', chevronDown: 'e5c7', chevronRight: 'e5cc', check: 'e5cd',
  refresh: 'e5d5', history: 'e889', lightMode: 'e3a9', darkMode: 'e3a8',
  device: 'e337', add: 'e145', delete: 'e5c9', edit: 'e3c9', sort: 'e5c3',
  filterList: 'e152', info: 'e88e', openInNew: 'e5d8', musicNote: 'e405',
} as const;
export type GlyphName = keyof typeof GLYPHS;
```

`app/src/components/Icon.tsx`:

```tsx
import React from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';
import { GLYPHS, GlyphName } from '../utils/glyphs';

const FAMILY = 'MaterialIcons';

export function glyph(name: GlyphName): string {
  return String.fromCodePoint(parseInt(GLYPHS[name], 16));
}

export default function Icon({
  name, size = 24, color = '#000', style,
}: {
  name: GlyphName; size?: number; color?: string; style?: StyleProp<TextStyle>;
}): React.JSX.Element {
  return (
    <Text
      accessible={false}
      style={[{ fontFamily: FAMILY, fontSize: size, color, lineHeight: size * 1.1 }, style]}
    >
      {glyph(name)}
    </Text>
  );
}
```

- [ ] **Step 4: Theme tokens (port of `frontend/src/theme.js` without MUI)**

`app/src/theme/tokens.ts`:

```ts
export const ACCENTS = [
  { id: 'green', name: 'Green', color: '#4CAF50' },
  { id: 'emerald', name: 'Emerald', color: '#10B981' },
  { id: 'teal', name: 'Teal', color: '#009688' },
  { id: 'lime', name: 'Lime', color: '#8BC34A' },
  { id: 'cyan', name: 'Cyan', color: '#00BCD4' },
  { id: 'blue', name: 'Blue', color: '#2196F3' },
  { id: 'indigo', name: 'Indigo', color: '#3F51B5' },
  { id: 'purple', name: 'Purple', color: '#9C27B0' },
  { id: 'pink', name: 'Pink', color: '#E91E63' },
  { id: 'red', name: 'Red', color: '#F44336' },
  { id: 'orange', name: 'Orange', color: '#FF5722' },
  { id: 'amber', name: 'Amber', color: '#FF9800' },
] as const;
export const DEFAULT_ACCENT = '#4CAF50';

export const FONTS = [
  { id: 'alexandria', name: 'Alexandria', family: 'Alexandria' },
  { id: 'cairo', name: 'Cairo', family: 'Cairo' },
  { id: 'system', name: 'System default', family: undefined as string | undefined },
] as const;
export const DEFAULT_FONT = 'alexandria';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface Theme {
  mode: 'light' | 'dark';
  accent: string;
  font: string;
  bg: string; paper: string; text: string; textSecondary: string; divider: string;
  radius: { sm: number; md: number; lg: number; pill: number };
}

export function buildTheme(mode: 'light' | 'dark', accent: string, fontId: string): Theme {
  const dark = mode === 'dark';
  const font = FONTS.find((f) => f.id === fontId) || FONTS[0];
  return {
    mode, accent, font: font.family ?? '',
    bg: dark ? '#0a0d0b' : '#f6f7f6',
    paper: dark ? '#121714' : '#ffffff',
    text: dark ? '#f1f4f2' : '#12160f',
    textSecondary: dark ? 'rgba(241,244,242,0.62)' : 'rgba(18,22,15,0.62)',
    divider: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)',
    radius: { sm: 10, md: 14, lg: 18, pill: 999 },
  };
}
```

- [ ] **Step 5: Font linking per platform (config only in this task)**

- Android/Windows/macOS: `npx react-native config` links `assets/fonts` (community CLI asset linking) — executed by each platform's build in later tasks.
- Linux: font registration is handled in `app/linux` glue (Task 16 Step 5) via `FcConfigAppFontAddFile` — note it, implement later.

- [ ] **Step 6: Verify + commit**

```bash
cd app && npm run typecheck && git add -A && git commit -m "feat(app): bundled fonts/icons and cross-platform theme tokens"
```

---

## Phase 1 — Portable TypeScript core (TDD: tests written first)

### Task 3: config, API client, format/track/artwork/lyrics utilities

**Files:**
- Create: `app/src/config.ts`, `app/src/services/api.ts`, `app/src/utils/format.ts`, `app/src/utils/track.ts`, `app/src/utils/artwork.ts`, `app/src/services/lyricsService.ts`
- Test: `app/src/utils/format.test.ts`, `app/src/utils/track.test.ts`, `app/src/services/lyricsService.test.ts`

- [ ] **Step 1: Write failing tests first**

`app/src/utils/format.test.ts`:

```ts
import { formatTime, parseDuration, safeFileName } from './format';

test('formatTime', () => {
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(303)).toBe('5:03');
  expect(formatTime(3723)).toBe('1:02:03');
  expect(formatTime('1:02:03')).toBe('1:02:03');
});

test('parseDuration', () => {
  expect(parseDuration('5:03')).toBe(303);
  expect(parseDuration('1:02:03')).toBe(3723);
  expect(parseDuration('nope')).toBeNull();
  expect(parseDuration(42)).toBe(42);
});

test('safeFileName strips unsafe characters', () => {
  expect(safeFileName('a/b:c*d?e"f<g>h|i')).toBe('a b c d e f g h i');
  expect(safeFileName('')).toBe('track');
});
```

`app/src/services/lyricsService.test.ts`:

```ts
import { toLrc, parseLrc, syncedLines, plainLyrics } from './lyricsService';

test('toLrc round-trips through parseLrc', () => {
  const lines = [{ timeMs: 0, text: 'Intro' }, { timeMs: 65_400, text: 'Line two' }];
  const lrc = toLrc(lines);
  expect(lrc).toBe('[00:00.00]Intro\n[01:05.40]Line two');
  expect(parseLrc(lrc)).toEqual(lines);
});

test('parseLrc ignores metadata lines and tolerates bad input', () => {
  expect(parseLrc('[ar:Artist]\n[00:01.00]Hi')).toEqual([{ timeMs: 1000, text: 'Hi' }]);
  expect(parseLrc('garbage')).toEqual([]);
});

test('syncedLines / plainLyrics extract payload fields', () => {
  const meta = { lyrics: { synced: [{ timeMs: 0, text: 'x' }], unsynced: 'hello' } };
  expect(syncedLines(meta)).toHaveLength(1);
  expect(plainLyrics(meta)).toBe('hello');
  expect(syncedLines({})).toBeNull();
  expect(plainLyrics({ lyrics: { unsynced: '  ' } })).toBeNull();
});
```

`app/src/utils/track.test.ts` — port expectations from `normalizeTrack`: given `{videoId:'abc', title:'T', artists:[{name:'A'}], duration:'3:05'}` → `{ videoId:'abc', title:'T', artist:'A', durationSeconds:185, artwork: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg' }`; given `{}` → `null`.

Run: `cd app && npm test` → FAIL (module not found).

- [ ] **Step 2: Implement `format.ts`**

Port `frontend/src/utils/format.js` verbatim to typed TS (`formatTime(value: number|string): string`, `parseDuration(value: number|string): number|null`, `safeFileName(name: string): string`).

- [ ] **Step 3: Implement `lyricsService.ts`**

Port `frontend/src/utils/lyrics.js` (`toLrc`, `syncedLines`, `plainLyrics`) **plus** a new `parseLrc(text: string): {timeMs:number; text:string}[]` (regex `/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/`, centis/millis handled) used for offline `.lrc` files and tests.

```ts
export interface LyricLine { timeMs: number; text: string }
export function toLrc(lines: LyricLine[]): string;
export function parseLrc(text: string): LyricLine[];
export function syncedLines(meta: unknown): LyricLine[] | null;
export function plainLyrics(meta: unknown): string | null;
```

- [ ] **Step 4: Implement `config.ts` + `api.ts`**

```ts
// app/src/config.ts
import env from '../env.json'; // optional override, ships {"apiBase": ""} by default
export const API_BASE = (env.apiBase || 'http://23.95.128.182:7181').replace(/\/+$/, '');
export const BRAND = 'Carmen';
```

`app/src/services/api.ts` — typed port of `frontend/src/api.js`: `ApiError` class (message/status/payload), `apiGet<T>(path, params?, signal?)` building the query string and parsing JSON, `streamUrl(videoId)`. RN fetch is global; `new URL()` is **not** available under some RN builds, so build the URL with string concatenation + `URLSearchParams`-free manual encoding (write a tiny `buildQuery(params)` helper).

```ts
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown) {
    super(message); this.name = 'ApiError';
  }
}
export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | undefined | null>, signal?: AbortSignal): Promise<T>;
export function streamUrl(videoId: string): string;
```

- [ ] **Step 5: Implement `track.ts` + `artwork.ts`**

Port `frontend/src/utils/track.js` (`normalizeTrack`, `normalizeList`, `artistNames`, `albumName`, `primaryArtwork`) and the URL-choosing half of `frontend/src/utils/artwork.js` (`cdnArtwork`, `pickArtwork` with JPEG-first/WebP-last and size sorting). Skip the DOM-only image preloading logic (RN `Image` handles caching). Add the shared `Track` interface to `app/src/types.ts`:

```ts
export interface Artist { name: string; id?: string | null }
export interface Track {
  videoId: string;
  title: string;
  artists: Artist[];
  artist: string;            // joined display string
  album: { name: string; id: string | null } | null;
  albumName: string;
  duration: string | null;
  durationSeconds: number | null;
  artwork: string | null;
  year: string | null;
  isExplicit: boolean;
  playlistId: string | null;
}
export interface LyricPayload { synced: LyricLine[] | null; unsynced: string | null; source: string | null }
export interface TrackMeta { title?: string; album?: { name: string; thumbnails?: unknown[] }; year?: string; genre?: string; lyrics?: LyricPayload; thumbnails?: unknown[] }
```

- [ ] **Step 6: Run tests → green; commit**

```bash
cd app && npm test && npm run typecheck
git add -A && git commit -m "feat(app): port api client and pure utils with jest coverage"
```

---

### Task 4: Theme provider + adaptive accent (cover → colour)

**Files:**
- Create: `app/src/theme/ThemeProvider.tsx`, `app/src/theme/adaptiveAccent.ts`
- Test: `app/src/theme/adaptiveAccent.test.ts`

- [ ] **Step 1: Write the failing test**

`adaptiveAccent.ts` exposes `dominantColor(bytes: Uint8Array): string | null` that decodes a JPEG/PNG (`jpeg-js` / `fast-png`, both pure JS → run everywhere) and returns the most saturated frequently-used colour. Test: build a 8×8 red PNG in the test (encode with `fast-png`'s `encode`) → expect `dominantColor(png)` to be a red hex (`/^#(f{2}|e{2})[0-5]{2}[0-5]{2}$/i`-ish, assert dominant channel is red).

- [ ] **Step 2: Implement `adaptiveAccent.ts`**

Algorithm: decode → downscale by sampling every Nth pixel (target ≤256×256 samples) → quantize each pixel to 4-bit/channel bins → count bins → prefer bins with saturation ≥ 0.35 and luminance in [0.15, 0.85]; if none, fall back to white `#ffffff` (the web app's "black cover → white accent" rule). Return `#rrggbb`.

- [ ] **Step 3: `ThemeProvider.tsx` (zustand-backed, ports `ThemeContext.jsx`)**

```ts
interface SettingsState {
  mode: ThemeMode; setMode(m: ThemeMode): void;          // 'light' | 'dark' | 'system'
  accent: string; setAccent(c: string): void;
  font: string; setFont(f: string): void;
  adaptiveAccent: boolean; setAdaptiveAccent(v: boolean): void;
  adaptiveColor: string | null; setAdaptiveColor(c: string | null): void;
  resolved: 'light' | 'dark';
  theme: Theme;                                          // buildTheme(resolved, accentInUse, font)
}
```

- Hydration: on boot, read `themeMode|accent|adaptiveAccent|font` from `settingsRepo` (Task 7) before rendering the shell (App shows a splash `View` until `hydrated`).
- System mode: `Appearance` addEventListener (`react-native` core) → re-resolve live.
- `accentInUse = adaptiveAccent && adaptiveColor ? adaptiveColor : accent`.
- Every setter writes through `settingsRepo.set(key, value)` (debounce not needed — these are rare).

- [ ] **Step 4: Verify + commit**

```bash
cd app && npm test && npm run typecheck && git add -A && git commit -m "feat(theme): cross-platform theme provider with cover-driven accent"
```

---

### Task 4B: Generate the native platform shells (Android, macOS, Windows)

**Gap fix:** the File Map assumes `app/android/`, `app/windows/`, `app/macos/` exist, but no task creates them. This task creates them before any native module work. `app/linux/` is deliberately deferred — GTK4 cannot be built on this macOS host, so it is generated by `scripts/setup-linux.sh` from the pinned rn-linux template (Task 6 bindings + Task 31 CI).

**Files:** create `app/android/**` (RN 0.83.10 community template, reconciled), `app/macos/**` (react-native-macos-init), `app/windows/**` (react-native-windows-init); modify `app/package.json` (platform deps + run scripts)

- [ ] **Step 1: Android shell** — generate the RN 0.83.10 template into a temp dir and reconcile:
  ```bash
  cd /tmp && rm -rf carmen-init && \
  npx @react-native-community/cli@latest init Carmen --version 0.83.10 \
       --skip-git-init --skip-install --pm npm --directory /tmp/carmen-init
  # copy android/ into app/, then reconcile:
  #  - settings.gradle rootProject.name → 'Carmen'   (matches app.json name)
  #  - app/build.gradle: applicationId/namespace 'com.z44d.carmen'
  #  - MainActivity/MainApplication package → com.z44d.carmen
  #  - gradle wrapper + AGP/Kotlin versions kept exactly as the template ships
  ```
- [ ] **Step 2: Verify Android** — `cd app/android && ./gradlew assembleDebug` → `BUILD SUCCESSFUL` (SDK + JDK 17 present; first run downloads Gradle — run it in the background with a long timeout).
- [ ] **Step 3: macOS shell** — `npm i -D react-native-macos@0.83.0` (or via `npx react-native-macos-init` which adds it) → generates `app/macos/`; reconcile project name `Carmen` + bundle id `com.z44d.carmen`. Verify: `npx react-native run-macos --mode Debug` if Xcode exists, else `pod install --project-directory=macos` + `xcodebuild -list` as a smoke test.
- [ ] **Step 4: Windows shell** — `npx react-native-windows-init --overwrite --version 0.83.2` (adds the `react-native-windows` dep + `windows/`). If the init CLI refuses to run on a non-Windows host, record it and leave generation to `windows.yml`'s first CI run (the workflow already runs the same init) — do NOT fake the folder.
- [ ] **Step 5: Scripts + commit**
  ```bash
  # ensure package.json scripts: windows, macos (per File Map)
  git add app/ && git commit -m "feat(app): native platform shells for android, macos and windows"
  ```

---

## Phase 2 — Embedded SQLite: bridge module, schema, repositories

### Task 5: `modules/samma3ni-db` TurboModule — spec + Android implementation

**Files:**
- Create: `app/modules/samma3ni-db/package.json`, `app/modules/samma3ni-db/tsconfig.json`, `app/modules/samma3ni-db/spec/NativeSamma3niDb.ts`, `app/modules/samma3ni-db/android/build.gradle`, `app/modules/samma3ni-db/android/src/main/java/com/samma3ni/db/Samma3niDbModule.kt`, `app/modules/samma3ni-db/index.ts`
- Create: `app/src/db/driver.ts`, `app/src/test/mocks/dbDriver.ts`

- [ ] **Step 1: Codegen spec**

`spec/NativeSamma3niDb.ts`:

```ts
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type DbRow = Record<string, string | number | null>;
export interface DbResult { rows: DbRow[]; rowsAffected: number; insertId?: number }

export interface Spec extends TurboModule {
  open(name: string): Promise<void>;                       // sandboxed <name>.db
  execute(sql: string, params: (string | number | null)[]): Promise<DbResult>;
  batch(statements: { sql: string; params: (string | number | null)[] }[]): Promise<void>;
  close(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Samma3niDb');
```

`app/modules/samma3ni-db/package.json` (autolinking + codegen):

```json
{
  "name": "samma3ni-db",
  "version": "1.0.0",
  "private": true,
  "main": "index.ts",
  "codegenConfig": {
    "name": "Samma3niDbSpec",
    "type": "modules",
    "jsSrcsDir": "spec"
  },
  "react-native": { "android": { "sourceDir": "android" } },
  "peerDependencies": { "react-native": "*" }
}
```

- [ ] **Step 2: Android Kotlin implementation** (framework SQLite — zero third-party deps)

`Samma3niDbModule.kt` essentials:

```kotlin
@ReactModule(name = Samma3niDbModule.NAME)
class Samma3niDbModule(context: ReactApplicationContext) :
  NativeSamma3niDbSpec(context) {

  private var db: SQLiteDatabase? = null
  private val io = Executors.newSingleThreadExecutor()

  override fun open(name: String, promise: Promise) {
    io.execute {
      try {
        val file = File(context.filesDir, "$name.db")
        db = SQLiteDatabase.openOrCreateDatabase(file, null)
        db?.enableWriteAheadLogging()
        promise.resolve(null)
      } catch (e: Exception) { promise.reject("EOPEN", e) }
    }
  }

  override fun execute(sql: String, params: ReadableArray, promise: Promise) {
    io.execute {
      try {
        val d = db ?: throw IllegalStateException("db not open")
        val args = params.toTypedArray()               // helper: string/int/double/null
        if (sql.trimStart().startsWith("SELECT", true) || sql.trimStart().startsWith("PRAGMA", true)) {
          d.rawQuery(sql, args.map { it?.toString() }?.toTypedArray()).use { c ->
            val rows = Arguments.createArray()
            while (c.moveToNext()) {
              val map = Arguments.createMap()
              for (i in 0 until c.columnCount) {
                when (c.getType(i)) {
                  Cursor.FIELD_TYPE_INTEGER -> map.putInt(c.getColumnName(i), c.getInt(i))
                  Cursor.FIELD_TYPE_FLOAT -> map.putDouble(c.getColumnName(i), c.getDouble(i))
                  Cursor.FIELD_TYPE_NULL -> map.putNull(c.getColumnName(i))
                  else -> map.putString(c.getColumnName(i), c.getString(i))
                }
              }
              rows.pushMap(map)
            }
            val out = Arguments.createMap(); out.putArray("rows", rows)
            out.putInt("rowsAffected", 0)
            promise.resolve(out)
          }
        } else {
          d.execSQL(sql, args)
          val out = Arguments.createMap(); out.putArray("rows", Arguments.createArray())
          out.putInt("rowsAffected", d.numberOfChanges)
          if (sql.trimStart().startsWith("INSERT", true)) out.putInt("insertId", d.lastInsertedRowId.toInt())
          promise.resolve(out)
        }
      } catch (e: Exception) { promise.reject("EEXEC", e) }
    }
  }

  override fun batch(statements: ReadableArray, promise: Promise) {
    io.execute {
      try {
        val d = db ?: throw IllegalStateException("db not open")
        d.beginTransaction()
        try {
          for (i in 0 until statements.size()) {
            val s = statements.getMap(i)!!
            d.execSQL(s.getString("sql")!!, s.getArray("params")!!.toTypedArray())
          }
          d.setTransactionSuccessful(); promise.resolve(null)
        } finally { d.endTransaction() }
      } catch (e: Exception) { promise.reject("EBATCH", e) }
    }
  }

  override fun close(promise: Promise) { io.execute { db?.close(); db = null; promise.resolve(null) } }
  companion object { const val NAME = "Samma3niDb" }
}
```

Plus `android/build.gradle` following the standard RN library template (`com.android.library`, `kotlin`, `com.facebook.react` gradle plugin, `buildscript` deps matching RN 0.83) and a `ReactPackage`/autolinking `index.ts` (`requireNativeModule('Samma3niDb')` behind the facade).

- [ ] **Step 3: TS facade + driver abstraction**

`app/src/db/driver.ts`:

```ts
export interface DbDriver {
  open(name: string): Promise<void>;
  execute(sql: string, params?: (string | number | null)[]): Promise<{ rows: DbRow[]; rowsAffected: number; insertId?: number }>;
  batch(statements: { sql: string; params?: (string | number | null)[] }[]): Promise<void>;
  close(): Promise<void>;
}

let driverPromise: Promise<DbDriver> | null = null;

export function getDriver(): Promise<DbDriver> {
  if (!driverPromise) driverPromise = createDriver();
  return driverPromise;
}

async function createDriver(): Promise<DbDriver> {
  if (process.env.JEST_WORKER_ID) {
    return (await import('../test/mocks/dbDriver')).createSqlJsDriver();
  }
  const native = await import('../native/db');
  return native.nativeDbDriver();
}
```

`app/src/test/mocks/dbDriver.ts` — sql.js in-memory driver (loads `sql.js` wasm dist from `node_modules/sql.js/dist/sql-wasm.wasm` with `locateFile`), implementing `DbDriver` against a `SQL.Database`. **This makes every repository testable for real** (actual SQL, actual migrations).

- [ ] **Step 4: Verify**

```bash
cd app && npm test && npm run typecheck
```
(No repo tests yet — Task 7 provides them.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): samma3ni-db turbo module spec, android impl and sql.js test driver"
```

---

### Task 6: Desktop implementations of `samma3ni-db` (macOS / Windows / Linux)

**Files:**
- Create: `app/modules/samma3ni-db/macos/*` (ObjC++/C++ podspec), `app/modules/samma3ni-db/windows/*` (C++/WinRT RNW native module), `app/modules/samma3ni-db/linux/*` (C++ CMake snippet for the rn-linux app)

- [ ] **Step 1: Shared C++ core**

`app/modules/samma3ni-db/desktop/DbEngine.h/.cpp` — one implementation used by all three desktop platforms:

```cpp
// Thin wrapper over the platform's system SQLite.
//  - macOS:   #include <sqlite3.h>, link -lsqlite3 (system dylib)
//  - Linux:   #include <sqlite3.h>, link libsqlite3 (apt libsqlite3-dev)
//  - Windows: dynamic load of winsqlite3.dll (ships with Windows 10+)
struct DbEngine {
  bool open(const std::string& path);          // WAL pragma applied after open
  bool exec(const std::string& sql, const std::vector<Value>& params, Result& out);
  bool batch(const std::vector<Statement>& stmts);   // BEGIN/COMMIT on failure ROLLBACK
  void close();
};
```

- Windows loader detail (`win.cpp`): `LoadLibraryW(L"winsqlite3.dll")` + `GetProcAddress` for `sqlite3_open_v2`, `sqlite3_prepare_v2`, `sqlite3_step`, `sqlite3_finalize`, `sqlite3_bind_*`, `sqlite3_column_*`, `sqlite3_last_insert_rowid`, `sqlite3_changes`, `sqlite3_close` — no SDK/lib file needed.
- Async: each public method runs on a detached `std::async` and resolves the TurboModule Promise (spec is Promise-based, so implementations never block the JS thread).

- [ ] **Step 2: Platform bindings**

- **macOS:** `Samma3niDb.mm` — RN-macos native module class (`RCT_EXTERN_MODULE` or TurboModule per rn-macos 0.83 codegen; mirror what `react-native-macos`'s own `NativeLocalStorage` sample does) calling `DbEngine`; podspec listing `sqlite3` in `libraries`/`frameworks`.
- **Windows:** `ReactPackageProvider`-registered C++/WinRT TurboModule (`@react-native-windows/codegen` generated `NativeSamma3niDb.h`), added to `windows/Carmen.vcxproj` via the RNW autolink step (rnw autolinking picks up local modules listed in `react-native.config.js`).
- **Linux:** `linux/Samma3niDb.cpp` registered through the rn-linux `rnLinux.*` binding table (their TurboModule autolinking is not wired yet — see their README “What doesn't yet”: in-tree/ad-hoc bindings). Wired in `app/linux/CMakeLists.txt` `target_link_libraries(... sqlite3)`.

- [ ] **Step 3: Verify**

```bash
# macOS native build (this machine):
cd app && npx react-native run-macos --mode Release 2>&1 | tail -20   # or xcodebuild, see DEVELOPMENT.md
# Windows + Linux: validated in Task 29/31 CI workflows (first CI run may be used as the build check)
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(db): system sqlite bindings for windows, macos and linux"
```

---

### Task 7: Schema, migration runner and repositories (TDD)

**Files:**
- Create: `app/src/db/migrations.ts`, `app/src/db/database.ts`, `app/src/db/repos/{settings,playback,playlists,favorites,tracks,downloads,feed,appState}.ts`
- Test: `app/src/db/repos/*.test.ts`

- [ ] **Step 1: Write failing repo tests**

Example (the rest follow the same shape — real SQL through the sql.js driver):

```ts
// app/src/db/repos/playlists.test.ts
import { getDriver } from '../driver';
import { runMigrations } from '../database';
import * as playlists from './playlists';

beforeEach(async () => { await runMigrations(await getDriver()); });

test('create → rename → delete playlist with cascading tracks', async () => {
  const id = await playlists.createPlaylist('Road trip');
  await playlists.upsertTrack({ videoId: 'a1', title: 'One', artist: 'X' });
  await playlists.addTrack(id, 'a1');
  expect((await playlists.listPlaylists())[0].trackCount).toBe(1);
  await playlists.renamePlaylist(id, 'Changed');
  expect((await playlists.listPlaylists())[0].name).toBe('Changed');
  await playlists.deletePlaylist(id);
  expect(await playlists.listPlaylists()).toHaveLength(0);
});
```

Also: `favorites.test.ts` (toggle/has/list), `downloads.test.ts` (insert → list sorted by `downloaded_at` → recent(10) → delete), `playback.test.ts` (save/load round-trip incl. `position_ms`, `queue_json`), `tracks.test.ts` (sort by title/artist/release asc+desc, favorites filter), `feed.test.ts` (recordPlay caps at 10, addSuggestions caps at 100 with FIFO + dedupe against recent — port the exact semantics of `library.js`), `settings.test.ts`, `appState.test.ts`.

Run `npm test` → FAIL.

- [ ] **Step 2: `migrations.ts` — full v1 schema**

```ts
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE tracks (
        video_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        artists_json TEXT NOT NULL DEFAULT '[]',
        album TEXT NOT NULL DEFAULT '',
        album_id TEXT,
        duration_seconds INTEGER,
        artwork TEXT,
        year TEXT,
        release_date TEXT,                 -- 'YYYY-MM-DD' or 'YYYY', sortable
        is_explicit INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_tracks_title  ON tracks(title COLLATE NOCASE);
      CREATE INDEX idx_tracks_artist ON tracks(artist COLLATE NOCASE);
      CREATE INDEX idx_tracks_release ON tracks(release_date);

      CREATE TABLE downloads (
        video_id TEXT PRIMARY KEY REFERENCES tracks(video_id) ON DELETE CASCADE,
        audio_path TEXT NOT NULL,
        artwork_path TEXT,
        lyrics_path TEXT,
        lyrics_synced INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER,
        downloaded_at INTEGER NOT NULL
      );
      CREATE INDEX idx_downloads_at ON downloads(downloaded_at DESC);

      CREATE TABLE playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        cover_video_id TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE playlist_tracks (
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, video_id)
      );
      CREATE INDEX idx_pt_pos ON playlist_tracks(playlist_id, position);

      CREATE TABLE favorites (
        video_id TEXT PRIMARY KEY REFERENCES tracks(video_id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE playback_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        queue_json TEXT NOT NULL DEFAULT '[]',
        history_json TEXT NOT NULL DEFAULT '[]',
        current_video_id TEXT,
        position_ms INTEGER NOT NULL DEFAULT 0,
        shuffle INTEGER NOT NULL DEFAULT 0,
        repeat TEXT NOT NULL DEFAULT 'off',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE feed_recent (
        video_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        played_at INTEGER NOT NULL
      );
      CREATE TABLE feed_suggestions (
        video_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `,
  },
];
```

- [ ] **Step 3: `database.ts` — open + migrate**

```ts
export async function getDb(): Promise<DbDriver> {
  const driver = await getDriver();
  if (!(globalThis as { __carmenDbReady?: boolean }).__carmenDbReady) {
    await driver.open('carmen');
    await runMigrations(driver);
    (globalThis as { __carmenDbReady?: boolean }).__carmenDbReady = true;
  }
  return driver;
}

export async function runMigrations(d: DbDriver): Promise<void> {
  await d.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
  const { rows } = await d.execute('SELECT MAX(version) AS v FROM schema_migrations');
  let current = Number(rows[0]?.v ?? 0);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await d.batch(m.sql.split('-- split') // v1 ships as one script: use execute directly
      .map((sql) => ({ sql: sql.trim() })));
    await d.execute('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
      [m.version, Date.now()]);
    current = m.version;
  }
}
```

(Implementation note: run each migration's script statement-by-statement — split on `;` at line ends inside a `BEGIN…COMMIT` batch — keep a tiny `splitStatements(sql)` helper with a test.)

- [ ] **Step 4: Repositories (complete signatures)**

`settings.ts`:
```ts
export async function getSetting(key: string): Promise<string | null>;
export async function setSetting(key: string, value: string): Promise<void>;
export async function getAllSettings(): Promise<Record<string, string>>;
```
Keys: `themeMode`, `accent`, `adaptiveAccent` ('0'|'1'), `font`, `lyricsProvider` ('auto'|'lrclib'|'musixmatch'|'netease'|'megalobiz'|'genius'), `apiBase` (optional override).

`appState.ts` (route persistence):
```ts
export async function saveAppState(key: string, value: unknown): Promise<void>;   // JSON
export async function loadAppState<T>(key: string, fallback: T): Promise<T>;
```
Key used: `navigation` → `{ stack: {name: string; params?: object}[] }`, plus `librarySection`.

`playback.ts`:
```ts
export interface PlaybackSnapshot {
  queue: Track[]; history: Track[]; currentVideoId: string | null;
  positionMs: number; shuffle: boolean; repeat: 'off' | 'all' | 'one'; updatedAt: number;
}
export async function savePlayback(s: PlaybackSnapshot): Promise<void>;
export async function loadPlayback(): Promise<PlaybackSnapshot | null>;
```

`playlists.ts`:
```ts
export interface Playlist { id: number; name: string; description: string; coverVideoId: string | null; isFavorite: boolean; position: number; trackCount: number; createdAt: number; updatedAt: number }
export async function createPlaylist(name: string, description?: string): Promise<number>;
export async function renamePlaylist(id: number, name: string): Promise<void>;
export async function setDescription(id: number, description: string): Promise<void>;
export async function deletePlaylist(id: number): Promise<void>;              // cascade
export async function listPlaylists(): Promise<Playlist[]>;
export async function getPlaylist(id: number): Promise<Playlist | null>;
export async function addTrack(playlistId: number, videoId: string): Promise<void>;
export async function removeTrack(playlistId: number, videoId: string): Promise<void>;  // renumbers positions
export async function moveTrack(playlistId: number, videoId: string, toPosition: number): Promise<void>;
export async function listTracks(playlistId: number): Promise<Track[]>;       // JOIN tracks ORDER BY position
export async function setPlaylistFavorite(id: number, favorite: boolean): Promise<void>;
```
(A playlist's tracks must exist in `tracks` — `tracks.upsertTrack` is always called before `addTrack`; `addTrack` inserts a stub row if missing so downloads aren't required to add a song to a playlist.)

`favorites.ts`:
```ts
export async function toggleFavorite(videoId: string): Promise<boolean>;      // returns new state
export async function isFavorite(videoId: string): Promise<boolean>;
export async function listFavorites(): Promise<Track[]>;
```

`tracks.ts`:
```ts
export async function upsertTrack(t: Track & { releaseDate?: string | null }): Promise<void>;
export type SortKey = 'title' | 'releaseDate' | 'artist';
export type SortDir = 'asc' | 'desc';
export interface SongsQuery { sort: SortKey; dir: SortDir; favoritesOnly?: boolean; search?: string }
export async function listDownloadedSongs(q: SongsQuery): Promise<Track[]>;  // JOIN downloads; ORDER BY maps:
//  title      → title COLLATE NOCASE
//  releaseDate→ release_date (NULLS last: `ORDER BY release_date IS NULL, release_date`)
//  artist     → artist COLLATE NOCASE
export async function listAlbums(): Promise<{ album: string; artwork: string | null; count: number }[]>;
export async function listArtists(): Promise<{ artist: string; artwork: string | null; count: number }[]>;
export async function getTrack(videoId: string): Promise<Track | null>;
```

`downloads.ts`:
```ts
export async function insertDownload(row: { videoId: string; audioPath: string; artworkPath?: string | null; lyricsPath?: string | null; lyricsSynced?: boolean; bytes?: number }): Promise<void>;  // + upsertTrack in same batch
export async function listRecent(limit = 10): Promise<(Track & { downloadedAt: number; audioPath: string })[]>;
export async function isDownloaded(videoId: string): Promise<boolean>;
export async function getDownload(videoId: string): Promise<{ audioPath: string; artworkPath: string | null; lyricsPath: string | null } | null>;
export async function deleteDownload(videoId: string): Promise<void>;          // files removed by caller
export async function countDownloads(): Promise<number>;
```

`feed.ts` (exact ports of `library.js` semantics):
```ts
export const RECENT_LIMIT = 10; export const SUGGESTION_LIMIT = 100; export const SUGGESTION_BATCH = 10;
export async function recordPlay(track: Track): Promise<void>;         // front, cap 10, removes from suggestions
export async function addSuggestions(tracks: Track[]): Promise<void>;   // first 10, dedupe, FIFO cap 100
export async function getFeed(): Promise<{ recent: Track[]; suggestions: Track[] }>;
export async function clearFeed(): Promise<void>;
```

- [ ] **Step 5: Run tests → green; commit**

```bash
cd app && npm test && npm run typecheck
git add -A && git commit -m "feat(db): v1 schema, migration runner and all repositories with tests"
```

---

## Phase 3 — Offline storage: `samma3ni-fs` + download pipeline

### Task 8: `modules/samma3ni-fs` — spec, Android impl, TS facade

**Files:**
- Create: `app/modules/samma3ni-fs/{package.json,spec/NativeSamma3niFs.ts,android/…,index.ts}`
- Create: `app/src/native/fs.ts`, `app/src/test/mocks/fsDriver.ts`

- [ ] **Step 1: Codegen spec**

```ts
export interface Spec extends TurboModule {
  paths(): Promise<{ root: string; documents: string; caches: string; temp: string }>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ size: number; modifiedAt: number } | null>;
  readFile(path: string): Promise<string>;                        // base64
  writeFile(path: string, base64: string): Promise<number>;       // bytes written
  remove(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;                           // absolute paths
  download(url: string, destPath: string, headers: object): Promise<{ bytes: number; contentType: string | null; status: number }>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('Samma3niFs');
```

`download` must emit progress events (`NativeEventEmitter` / `RCTDeviceEventEmitter`, event `Samma3niFs:progress` with `{destPath, loaded, total}`) so the Downloads UI shows a real percentage.

- [ ] **Step 2: Android Kotlin impl**

- `paths()`: `context.filesDir` → documents; `context.cacheDir` → caches/temp; root = filesDir's parent.
- `download`: `HttpURLConnection` (or OkHttp if already on classpath — RN ships OkHttp) with streaming copy loop 64 KB chunks → emit progress every ≥1 % → write to `dest.tmp` then atomic `renameTo(dest)`; redirects followed; `contentType` from `Content-Type`. Cleartext HTTP allowed via `android:usesCleartextTraffic="true"` (added in Task 13's manifest edit).
- `readFile/writeFile`: `Base64.encodeToString/decode` with `Base64.NO_WRAP`.

- [ ] **Step 3: TS facade + test driver**

`app/src/native/fs.ts` exports a portable `sandbox` API (the *only* module the app code uses):

```ts
export interface Sandbox {
  paths(): Promise<Roots>;
  songDir(videoId: string): Promise<string>;        // <documents>/songs/<videoId>
  writeText(path: string, text: string): Promise<void>;
  readText(path: string): Promise<string>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;   // via base64
  readBytes(path: string): Promise<Uint8Array>;
  download(url: string, destPath: string, onProgress?: (loaded: number, total: number) => void): Promise<{ bytes: number; contentType: string | null }>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  resolveSong(videoId: string, name: string): string;   // pure path join helper (unit-tested)
}
```

`app/src/test/mocks/fsDriver.ts` — in-memory map-backed driver (`Map<string, Uint8Array>`) for Jest; `download` is replaced in tests by injecting bytes through a `__setDownloadHandler` hook.

- [ ] **Step 4: Unit test `resolveSong` + facade behaviour with the mock driver; commit**

```bash
cd app && npm test && npm run typecheck
git add -A && git commit -m "feat(fs): samma3ni-fs module with sandbox facade and download progress"
```

---

### Task 9: Desktop implementations of `samma3ni-fs`

**Files:**
- Create: `app/modules/samma3ni-fs/desktop/FsEngine.{h,cpp}` + `macos/`, `windows/`, `linux/` bindings (same layout as Task 6)

- [ ] **Step 1: Shared C++ engine**

- `paths()` per platform:
  - **macOS:** `~/Library/Application Support/Carmen` (root), `…/Carmen/songs`, caches `~/Library/Caches/Carmen`.
  - **Windows:** `%LOCALAPPDATA%\Carmen`, caches `%LOCALAPPDATA%\Carmen\Cache`.
  - **Linux:** `$XDG_DATA_HOME/carmen` (fallback `~/.local/share/carmen`), caches `$XDG_CACHE_HOME/carmen`.
- File ops: `std::filesystem` (create_directories, remove, file_size, last_write_time) — C++17, identical on all three.
- `download`: HTTP via **libsoup3** on Linux (already a rn-linux dependency), `NSURLSession` on macOS, **WinHTTP** (`WinHttpOpen/Receive`) on Windows. Streaming write + progress callback every 64 KB. This is the one place with per-platform code — keep the shared parts (temp file + atomic rename + progress throttle) in `FsEngine.cpp`.

- [ ] **Step 2: Bindings** — mirror Task 6 Step 2 (ObjC++ pod, RNW C++/WinRT, rn-linux ad-hoc binding table).

- [ ] **Step 3: Verify (macOS local, others via CI in Tasks 29/31)**

```bash
cd app && npx react-native run-macos 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(fs): portable sandbox file engine for desktop targets"
```

---

### Task 10: Download pipeline — raw audio + `.lrc` + artwork → sandbox (no conversion, no tagging)

**Files:**
- Create: `app/src/services/downloadService.ts`, `app/src/state/downloadsStore.ts`
- Test: `app/src/services/downloadService.test.ts`

- [ ] **Step 1: Failing test for the pipeline**

Mock `services/api` (fetch), mock `native/fs` driver, use real repos (sql.js):

```ts
test('download writes audio + artwork + lrc and records the row', async () => {
  __setDownloadHandler((url) => url.includes('/stream') ? { bytes: AUDIO, contentType: 'audio/mp4' }
                        : { bytes: JPEG, contentType: 'image/jpeg' });
  await downloadService.download(track, meta, { baseUrl: 'http://x' });
  expect(await downloadsRepo.getDownload('abc')).toMatchObject({ audioPath: expect.stringContaining('audio.m4a') });
  expect(await fs.exists(await fs.resolveSongDir('abc', 'lyrics.lrc'))).toBe(true);
  expect(await tracksRepo.getTrack('abc')).toMatchObject({ title: 'Song' });
});
```

- [ ] **Step 2: `downloadsStore.ts` (zustand, port of the observable in `downloads.js` minus ffmpeg)**

```ts
interface DownloadJob { videoId: string; title: string; status: 'idle'|'running'|'done'|'error'; step: string; progress: number; error?: string }
interface DownloadsState { jobs: Record<string, DownloadJob>; notice: {id:number; severity:'success'|'error'|'info'; message:string} | null;
  start(track: Track, meta: TrackMeta | null): Promise<void>; clearNotice(): void }
```

- [ ] **Step 3: `downloadService.ts` — the full pipeline**

```ts
export async function download(track: Track, meta: TrackMeta | null, opts?: { waitForCache?: () => Promise<void> }): Promise<void> {
  // 1. job: 'Waiting for the stream to finish caching' → await opts.waitForCache() (port of waitForCache polling /stream/status, bounded 60s / 3× unreachable / 12s stall)
  // 2. job: 'Downloading audio' 0..0.85
  //      ext = extensionFrom(contentType): audio/mp4|m4a→m4a, audio/webm|video/webm→webm, audio/mpeg→mp3, fallback 'm4a'
  //      dest = <documents>/songs/<videoId>/audio.<ext>
  //      fs.download(streamUrl(videoId), dest, onProgress)   // RAW bytes — no transcode, no ID3 (requirement 4)
  // 3. job: 'Saving artwork' 0.85..0.92
  //      candidates = [cdnArtwork(id), i.ytimg hq720/sddefault/hqdefault, pickArtwork(meta?.thumbnails), track.artwork]
  //      first successful JPEG > 1 KB → <dir>/artwork.jpg (bytes stored as-is; square-crop is NOT required — RN <Image> resizeMode handles framing)
  // 4. job: 'Saving lyrics' 0.92..0.97
  //      synced = syncedLines(meta): if synced → lyrics.lrc = toLrc(synced); else unsynced → lyrics.txt; else no file
  // 5. job: 'Saving to library' 0.97..1
  //      batch: tracks.upsertTrack(track + releaseDate from meta.year/publishDate) + downloads.insertDownload({...})
  // 6. job done + notice 'Saved "<artist> - <title>"'
}
export async function removeDownload(videoId: string): Promise<void>;   // fs.removeDir(<dir>) + downloadsRepo.deleteDownload
```

Extension rule matters for playback: the server streams `bestaudio[ext=m4a]` first, so `.m4a` (AAC) is the normal case and plays natively on all four engines; `.webm`/Opus is the rare fallback — engine error handlers surface a clear message (documented in DEVELOPMENT.md).

- [ ] **Step 4: Green test → commit**

```bash
cd app && npm test && npm run typecheck
git add -A && git commit -m "feat(downloads): offline raw-audio pipeline with artwork and synced lyrics"
```

---

### Task 11: Strip conversion/tagging everywhere + regression gate

**Files:**
- Modify: `app/package.json` (never add the deps), `.github/workflows/ci.yml` (later — add gate step in Task 27)
- Verify: repo-wide grep

- [ ] **Step 1: Confirm zero conversion/tagging surface**

```bash
# must return no matches inside app/ (and none in server/):
grep -rniE "ffmpeg|browser-id3-writer|ID3Writer|libmp3lame|transcod" app/src app/modules || echo "APP CLEAN"
grep -rniE "FFmpegExtractAudio|FFmpegVideoConvertor|postprocessor" server/ || echo "SERVER CLEAN"
```

- [ ] **Step 2: Confirm the legacy web app is untouched (it is a separate target)**

```bash
git status --porcelain frontend/   # must be empty
```

- [ ] **Step 3: Note in the server docstring** — `server/core.py get_track` docstring still says "the browser side MP3 tagging"; update that sentence to "the client's offline download metadata" (tiny docs-only edit, same commit).

```bash
git add server/core.py && git commit -m "docs(server): drop browser mp3 tagging mention from get_track"
```

---

## Phase 4 — Playback engine + system tray

### Task 12: `samma3ni-audio` spec + TS `AudioEngine` facade + `playerStore` (TDD)

**Files:**
- Create: `app/modules/samma3ni-audio/{package.json,spec/NativeSamma3niAudio.ts,index.ts}`, `app/src/native/audio.ts`, `app/src/test/mocks/audioDriver.ts`
- Create: `app/src/state/playerStore.ts`, `app/src/services/playbackService.ts`
- Test: `app/src/state/playerStore.test.ts`

- [ ] **Step 1: Codegen spec (single-source engine — queue lives in JS)**

```ts
export interface NowPlaying {
  title: string; artist: string; album: string;
  artworkPath: string | null;        // absolute local file — works offline (requirement 4)
  durationMs: number;
}
export interface Spec extends TurboModule {
  load(source: { uri: string }, startAtMs: number): Promise<void>;   // uri: file://… or http(s)://…
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
  stop(): Promise<void>;
  setNowPlaying(meta: NowPlaying | null): Promise<void>;             // drives native MediaSession / SMTC / MPNowPlayingInfo / MPRIS
  setPlaying(playing: boolean): Promise<void>;
  // events (DeviceEventEmitter): 'Audio:state' {state:'idle'|'loading'|'ready'|'playing'|'paused'|'ended'|'error'}
  //                              'Audio:time'   {positionMs, durationMs}   (≥5 Hz while playing, immediate on seek)
  //                              'Audio:error'  {code, message}
}
export default TurboModuleRegistry.getEnforcing<Spec>('Samma3niAudio');
```

OS media buttons (next/prev/play/pause/seek) arrive **through the same events** (`Audio:state` variants `next`, `prev`, `seek` payloads) — each desktop impl forwards its native callback (`SMTC.ButtonPressed`, `MPRemoteCommandCenter`, MPRIS `Next/Previous/SetPosition`) into the event stream, and JS maps them onto store actions in `playbackService`.

- [ ] **Step 2: Failing tests for the store (port PlayerContext semantics)**

`playerStore.test.ts` covers exactly the behaviours of `PlayerContext.jsx`:

```ts
test('playTrack with context sets queue to the songs after it', …);
test('re-pressing the current track toggles play instead of restarting', …);
test('next() with shuffle picks a random non-current queue entry and removes it', …);
test('when the queue empties next() continues from related (unplayed first)', …);
test("repeat 'all' restarts from history when queue+related are exhausted", …);
test("repeat 'one' on ended restarts the same track", …);
test('previous restarts when >3s in, else pops history', …);
test('addToQueue / playNext / removeFromQueue / clearQueue', …);
test('toggleShuffle shuffles the queue in place on enable', …);
test('cycleRepeat cycles off → all → one → off', …);
```

- [ ] **Step 3: `playerStore.ts` (zustand) — state + actions**

```ts
interface PlayerState {
  // hydration
  hydrated: boolean;
  current: Track | null; meta: TrackMeta | null;
  queue: Track[]; history: Track[]; related: Track[]; relatedFor: string | null;
  // transport
  isPlaying: boolean; buffering: boolean; error: string | null;
  currentTime: number;        // seconds (UI), updated from Audio:time (5 Hz) + interpolated by SeekBar's Animated value
  duration: number; buffered: number;
  shuffle: boolean; repeat: 'off' | 'all' | 'one';
  sheetOpen: boolean; setSheetOpen(v: boolean): void;
  // actions (same names as the web app)
  playTrack(raw: Track | object, context?: Track[] | null, opts?: { openSheet?: boolean }): void;
  playAll(tracks: Track[], index?: number): void;
  addToQueue(raw: Track): void; playNext(raw: Track): void;
  removeFromQueue(index: number): void; clearQueue(): void;
  togglePlay(): void; next(auto?: boolean): void; previous(): void;
  seek(seconds: number): void; toggleShuffle(): void; cycleRepeat(): void;
  dismissError(): void;
  hydrate(): Promise<void>;    // load playback_state → restore queue + position WITHOUT autoplay
}
```

Persistence rule (requirement 5): a `subscribe` in `playbackService.ts` debounces `playbackRepo.savePlayback(...)` to **2 s** after any change of `queue/history/current/shuffle/repeat`, and writes `positionMs` on: every `Audio:time` tick aggregated at 5 s cadence, `pause`, `stop`, `AppState` background, and `closeRequested` from the tray module (flush is *synchronous-ish* — awaited before hiding the window).

- [ ] **Step 4: `playbackService.ts` wiring**

```ts
export function bindPlayback(): void {
  // 1. hydrate(): store.hydrate() → if current: engine.load(fileUri|streamUri, positionMs) + setPlaying(false)
  // 2. store subscription → when current.videoId changes:
  //      downloadsRepo.getDownload(id) ? file://<audio_path> : streamUrl(id)     // offline-first (requirement 4)
  //      fs / meta → engine.load(uri, 0); engine.setNowPlaying({title, artist, album, artworkPath, durationMs})
  //      apiGet(/browsing/track/) → meta (skip when offline file has no network? errors are swallowed as in web app)
  //      apiGet(/browsing/related/) → related + feedRepo.addSuggestions(first 10)
  //      feedRepo.recordPlay(current)
  // 3. engine events → store: state→isPlaying/buffering/ended→next(true)/error→error message
  // 4. AppState change → persist snapshot
}
```

Source resolution order — **local file first**: `file://<documents>/songs/<id>/audio.*`; artwork for MediaSession: local `artwork.jpg` first, else the remote URL (requirement: "Dynamically read local cover art, title, and artist data to update native MediaSession during offline playback").

- [ ] **Step 5: Green tests → commit**

```bash
cd app && npm test && npm run typecheck
git add -A && git commit -m "feat(player): engine facade, queue semantics and playback persistence"
```

---

### Task 13: Android engine (Media3 ExoPlayer + MediaSessionService)

**Files:**
- Create: `app/modules/samma3ni-audio/android/` (build.gradle, `Samma3niAudioModule.kt`, `PlaybackService.kt`)
- Modify: `app/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Gradle deps**

```gradle
implementation "androidx.media3:media3-exoplayer:1.5.0"
implementation "androidx.media3:media3-session:1.5.0"
```

- [ ] **Step 2: `PlaybackService` (MediaSessionService)**

- Creates `ExoPlayer` + `MediaSession` in `onGetSession()`; `setForegroundServiceBehavior(FOREGROUND_SERVICE_NOTIFICATION_PERMITTED)`.
- Metadata: `MediaItem.Builder().setUri(uri).setMediaMetadata(MediaMetadata.Builder().setTitle/Artist/AlbumArtUri(local artwork file)/setDurationMs…)` — artwork from a `file://` URI works for the notification/lockscreen ✅ offline.
- Position/state events: a `Handler` polls `player.currentPosition` every 200 ms **only while playing** (5 Hz min per spec) and emits `Audio:time` via `DeviceEventEmitter`; `Player.Listener` maps states.
- `MediaSession.Callback` onPlay/onPause/onSeek/toNext/onPrevious/onCustomAction → emit engine events (JS store remains source of truth for *queue* next/prev: native `onSkipToNext` just emits `next` event).

- [ ] **Step 3: Module glue** — `load/play/pause/seek/stop/setNowPlaying/setPlaying` against the service-connected player (bound service or singleton holder started from the module).

- [ ] **Step 4: Manifest**

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<application android:usesCleartextTraffic="true" …>
  <service android:name=".PlaybackService"
    android:foregroundServiceType="mediaPlayback"
    android:exported="true">
    <intent-filter>
      <action android:name="androidx.media3.session.MediaSessionService" />
    </intent-filter>
  </service>
</application>
```

- [ ] **Step 5: Verify build**

```bash
cd app && npm run android      # requires device/emulator; else: cd android && ./gradlew assembleDebug
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(audio): android media3 engine with media session and background service"
```

---

### Task 14: macOS engine (AVPlayer + MPNowPlayingInfoCenter)

**Files:**
- Create: `app/modules/samma3ni-audio/macos/Samma3niAudio.{h,mm}`, podspec

- [ ] **Step 1: Core player**

```objc
@interface Samma3niAudio : NSObject <RCTEventEmitter>
@property (nonatomic, strong) AVPlayer *player;
@property (nonatomic, strong) id timeObserver;   // interval 0.2s → Audio:time
@end
```

- `load:` → `AVPlayerItem(url: URL(string: uri)!)` (file:// and https:// both work), `replaceCurrentItem`, `addPeriodicTimeObserver(forInterval: CMTimeMake(1, 5))` → emit `Audio:time`; `AVPlayerItemDidPlayToEndTime` → `Audio:state ended`; KVO on `status`/`timeControlStatus` → `loading|ready|playing|paused`.

- [ ] **Step 2: Now Playing**

```objc
- (void)setNowPlaying:(NSDictionary*)meta {
  MPMediaItemArtwork *art = nil;
  NSString *path = meta[@"artworkPath"];
  if (path) { UIImage *img = [UIImage imageWithContentsOfFile:path];
              if (img) art = [[MPMediaItemArtwork alloc] initWithBoundsSize:img.size
                 requestHandler:^UIImage* (CGSize s){ return img; }]; }
  [MPNowPlayingInfoCenter defaultCenter].nowPlayingInfo = @{
    MPMediaItemPropertyTitle: meta[@"title"] ?: @"",
    MPMediaItemPropertyArtist: meta[@"artist"] ?: @"",
    MPMediaItemPropertyAlbumTitle: meta[@"album"] ?: @"",
    MPMediaItemPropertyPlaybackDuration: @( [meta[@"durationMs"] doubleValue] / 1000.0 ),
    MPMediaItemPropertyArtwork: art ?: NSNull.null  // filter NSNull before assign
  };
}
```

Remote commands (`playCommand/pauseCommand/nextTrackCommand/previousTrackCommand/changePlaybackPositionCommand`) registered once → emit the corresponding engine events.

- [ ] **Step 3: Verify build + commit**

```bash
cd app && npx react-native run-macos 2>&1 | tail -5
git add -A && git commit -m "feat(audio): macos avplayer engine with now playing integration"
```

---

### Task 15: Windows engine (WinRT MediaPlayer + SMTC)

**Files:**
- Create: `app/modules/samma3ni-audio/windows/Samma3niAudio.h/.cpp`, registered in `windows/` project

- [ ] **Step 1: Player**

```cpp
winrt::Windows::Media::Playback::MediaPlayer player_;
// load(uri): player_.Source(winrt::Windows::Media::Core::MediaSource::CreateFromUri(uri))  // file:// and http(s)
// play/pause/seek: player_.PlaybackSession().Position(TimeSpan{ms})
// events: PlaybackSession().PositionChanged → throttled 200 ms → Audio:time
//         NaturalDurationChanged → durationMs; AudioFrameCompleted / MediaEnded → Audio:state ended
```

- [ ] **Step 2: SMTC**

```cpp
auto smtc = player_.SystemMediaTransportControls();     // auto-created by MediaPlayer
smtc.IsPlayEnabled(true); smtc.IsPauseEnabled(true);
smtc.IsEnabled(true);
smtc.ButtonPressed({this, &Samma3niAudio::OnButtonPressed});   // Play/Pause/Next/Prev → engine events
// setNowPlaying: smtc.DisplayUpdater().Type(MediaPlaybackType::Music);
//   MusicProperties().Title(...).Artist(...).AlbumTitle(...);
//   Thumbnail(RandomAccessStream::CreateFromFile(artworkPath))  ← local file, offline OK
//   DisplayUpdater().Update();
smtc.PlaybackStatus(MediaPlaybackStatus::Playing /* or Paused */);
```

- [ ] **Step 3: Build verification happens in Task 29 (Windows CI)** — locally just `npm run typecheck`; add the module files to `windows/Carmen.vcxproj.filters` if rnw autolinking does not pick local modules automatically (document either way).

```bash
git add -A && git commit -m "feat(audio): windows winrt media player with smtc controls"
```

---

### Task 16: Linux engine (GStreamer playbin + MPRIS)

**Files:**
- Create: `app/modules/samma3ni-audio/linux/Samma3niAudio.cpp`, CMake lists additions

- [ ] **Step 1: GStreamer**

```cpp
// gst_init once; element = gst_element_factory_make("playbin", nullptr)
// set "uri" (file:///… or https://… — playbin handles both; https needs gst-plugins-good soup)
// bus watch: EOS → Audio:state ended; ERROR → Audio:error; STATE_CHANGED → ready/playing/paused
// position: g_timeout_add(200, …) while PLAYING → gst_element_query_position → Audio:time
// apt deps: libgstreamer1.0-dev gstreamer1.0-plugins-base gstreamerer-plugins-good gstreamer1.0-plugins-ugly libgstreamer-plugins-bad1.0-dev
// opus (webm fallback): gstreamer1.0-plugins-base includes opus? → add gstreamer1.0-libav for aac/mp3 demux coverage
```

- [ ] **Step 2: MPRIS over GDBus**

- Export `org.mpris.MediaPlayer2.carmen` on the session bus: interfaces `org.mpris.MediaPlayer2` (Raise/Quit — Raise emits JS `openRequest`) and `org.mpris.MediaPlayer2.Player` (Play/Pause/Next/Previous/SetPosition/OpenUri, properties PlaybackStatus, Metadata, Position, Volume).
- `Metadata`: `mpris:trackid`, `mpris:length` (µs), `xesam:title/artist/album`, `mpris:artUrl` = `file://…` local artwork (offline ✅).
- Emit `Audio:*` events from the command handlers.

- [ ] **Step 3: Build verification via Linux CI (Task 31); local check is `npm run bundle:linux`.**

```bash
cd app && npm run bundle:linux
git add -A && git commit -m "feat(audio): linux gstreamer engine with mpris"
```

---

### Task 17: `samma3ni-tray` + close-to-tray lifecycle (requirement 2)

**Files:**
- Create: `app/modules/samma3ni-tray/{package.json,spec/NativeSamma3niTray.ts,macos/,windows/,linux/}` (no Android)
- Create: `app/src/native/tray.ts`, `app/src/native/window.ts`, `app/src/services/desktopLifecycle.ts`
- Test: `app/src/services/desktopLifecycle.test.ts`

- [ ] **Step 1: Spec**

```ts
export interface TrayItem { id: string; label: string; separatorBefore?: boolean; disabled?: boolean }
export interface Spec extends TurboModule {
  isSupported(): Promise<boolean>;                 // false on Android/iOS
  init(iconPath: string, tooltip: string, items: TrayItem[]): Promise<void>;
  setItems(items: TrayItem[]): Promise<void>;
  setPlayingState(state: { title: string; artist: string; playing: boolean }): Promise<void>;  // optional menu line / tooltip
  hideWindow(): Promise<void>;
  showWindow(): Promise<void>;                     // restore + focus + route restore is JS-side
  flushAndQuit(): Promise<void>;                   // emits 'closeRequested', waits ~300 ms, exits process
  // events: 'Tray:menuAction' {id} · 'Tray:openRequest' (click/restore) · 'Window:closeRequested'
}
```

- [ ] **Step 2: macOS — `NSStatusItem` + `windowShouldClose`**

```objc
// init: NSStatusItem *item = [NSStatusItem button]; item.button.image = tray image; menu built from items.
- (BOOL)windowShouldClose:(NSWindow*)sender {          // RCTHostApplication window delegate
  [sender orderOut:nil];                               // hide — process keeps playing (requirement 2)
  [self sendEventWithName:@"Window:closeRequested" body:@{}];   // JS flushes route + playback state
  return NO;                                           // do NOT close
}
// 'Tray:openRequest': [NSApp activateIgnoringOtherApps:YES]; [window makeKeyAndOrderFront:nil];
// Quit item → flushAndQuit → [NSApp terminate:nil]
// macOS keeps the process alive with no windows by default (applicationShouldTerminateAfterLastWindowClosed → NO).
```

- [ ] **Step 3: Windows — `Shell_NotifyIcon` + close intercept**

- RNW 0.83 runs as a full-trust packaged desktop app (the template's manifest requests `runFullTrust`), so Win32 `Shell_NotifyIconW` is available; obtain the window HWND via `ICoreWindowInterop` (or `AppWindow().Hwnd()` on WinUI3 paths) in the module's `init`.
- Tray: `NOTIFYICONDATAW` + `WM_APP+1` callback → left click = `Tray:openRequest`, right click = `TrackPopupMenu` built from `setItems` → `Tray:menuAction`.
- Close intercept (in `App.cpp` / window's `Closed` handling): instead of destroying, call `window.Hide()` (AppWindow) or `ShowWindow(hwnd, SW_HIDE)` and emit `Window:closeRequested`. Quit menu item: `PostQuitMessage(0)` after flush. Also handle `WM_QUERYENDSESSION` normally.
- If the RNW version's window plumbing makes `Closed` un-cancelable, fallback documented in code: treat `VisibilityChanged→hidden` as close-to-tray (hide already happened) and re-show on tray click — both paths emit the same JS events.

- [ ] **Step 4: Linux — StatusNotifierItem + dbusmenu over GDBus (GTK4 has no GtkStatusIcon)**

- Export `org.kde.StatusNotifierItem` on the session bus (`/StatusNotifierItem`), properties `Category=ApplicationStatus`, `IconName`/`IconPixmap` (PNG bytes from `iconPath`), `Status=Active`, `Title`.
- Menu: implement the `com.canonical.dbusmenu` interface (`GetLayout`, `GetGroupProperties`, `Event`) with a flat menu: **Open Carmen**, separator, **Pause/Resume**, **Next**, separator, **Quit**. Use libdbusmenu only if available; the raw GDBus implementation avoids the GTK3 `GtkMenu` API that GTK4 removed.
- Close intercept: connect to the GTK window's `close-request` signal → `gtk_widget_hide_on_delete` semantics: hide + emit `Window:closeRequested` + return `TRUE` (prevents destruction). `GtkApplication` is kept alive with `g_application_hold()` while hidden. `Tray:openRequest` → `gtk_window_present()`.
- Session bus absent (rare) → `isSupported()` still true but `init` degrades to no-icon + close→minimize (documented fallback).

- [ ] **Step 5: `desktopLifecycle.ts` (JS, testable)**

```ts
export function bindDesktopLifecycle(nav: NavApi, player: PlayerApi): void {
  // Window:closeRequested (debounced once):
  //   1. await appStateRepo.saveAppState('navigation', nav.snapshot())
  //   2. await playbackRepo.savePlayback(player.snapshot())   // exact currentTime (requirement 2 & 5)
  //   3. tray.hideWindow()  (already hidden natively; no-op guard)
  // Tray:menuAction 'open' → tray.showWindow()  (nav state still in memory → same page restored)
  // Tray:menuAction 'quit' → tray.flushAndQuit()
}
```

Test (`desktopLifecycle.test.ts`): with mocked tray + repos, assert that a `closeRequested` event persists the navigation snapshot and playback snapshot with the exact `positionMs`, in order.

- [ ] **Step 6: Verify + commit**

```bash
cd app && npm test && npm run typecheck && npm run bundle:macos
git add -A && git commit -m "feat(tray): close-to-tray on desktop with state flush and restore"
```

---

## Phase 5 — Navigation, app shell and core screens

### Task 18: Navigation store, Router, route persistence (requirement 2)

**Files:**
- Create: `app/src/navigation/types.ts`, `app/src/navigation/navStore.ts`, `app/src/navigation/Router.tsx`, `app/src/test/mocks/*` updates
- Test: `app/src/navigation/navStore.test.ts`

- [ ] **Step 1: Route model**

```ts
export type RouteName = 'home' | 'search' | 'queue' | 'settings' | 'library' | 'collection' | 'nowPlaying';
export interface RouteEntry { name: RouteName; params?: { kind?: 'album'|'playlist'; id?: string; query?: string } }
export interface NavState {
  stack: RouteEntry[];                       // bottom = root, top = visible
  booted: boolean;
  push(route: RouteEntry): void;
  replace(route: RouteEntry): void;
  pop(): void;
  reset(stack: RouteEntry[]): void;          // used by restore
  hydrate(): Promise<void>;                  // read appState 'navigation', reset() it
  snapshot(): RouteEntry[];                  // for persistence
}
```

- Transitions: `Router.tsx` renders only `stack[stack.length-1]`; `push/pop` animate with core `Animated` (slide 24 px + fade, 180 ms, `Animated.timing` JS driver — safe on all platforms). Tab roots (home/search/queue/library/settings) are `reset([{name}])` so the back stack stays shallow; `collection` and `nowPlaying` are pushed.
- Persistence: `navStore.subscribe` debounced 300 ms → `appStateRepo.saveAppState('navigation', snapshot)`; **plus** synchronous flush on `Window:closeRequested` (Task 17) and on `AppState` background. Boot: `hydrate()` before first paint (splash until `booted`), so reopening from tray *or* cold start lands on the exact page (requirement 2).

- [ ] **Step 2: Tests** — push/pop/reset semantics; `snapshot → hydrate → reset` round-trip; debounce writes once for rapid pushes (fake timers).

```bash
cd app && npm test
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(nav): stack router with debounced route persistence and boot restore"
```

---

### Task 19: App shell + Home, Search, Queue, Collection screens

**Files:**
- Create: `app/src/components/AppShell.tsx`, `app/src/screens/{HomeScreen,SearchScreen,QueueScreen,CollectionScreen}.tsx`, `app/src/components/{TrackRow,TrackList,MediaCard,CardGrid,EmptyState,Snackbar,Artwork}.tsx`, `app/src/services/snackbars.ts`, rewrite `app/App.tsx`

- [ ] **Step 1: Providers order in `App.tsx`**

```tsx
export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => { (async () => {
      await settingsStore.hydrate();       // theme + lyrics provider
      await navStore.hydrate();            // route restore
      bindPlayback();                      // engine glue (Task 12)
      bindDesktopLifecycle(navStore, playerStore);   // no-op on Android
      setReady(true);
    })(); }, []);
  if (!ready) return <Splash />;           // solid bg color from buildTheme default
  return <ThemeProvider><SnackbarProvider><Router /></ThemeProvider></SnackbarProvider>;
}
```

- [ ] **Step 2: `AppShell.tsx` (ports `Layout.jsx` responsibilities)**

- Desktop (`useWindowDimensions().width >= 900` **and** Platform != android): permanent left rail (216 px) — Home / Search / Queue / Library / Settings with `Icon` + label, translucent paper over `AmbientBackground`; top bar with current route title + light/dark toggle.
- Mobile: top bar (56 px) + bottom tab bar (56 px + bottom inset) with the same 5 tabs; `useSafeInsets()` util (Android: top = `StatusBar.currentHeight`, bottom = `screen.height - window.height` heuristic; desktop: 0).
- `<MiniPlayer />` docked above the bottom bar (mobile) / bottom-left (desktop), hidden while `nowPlaying` route is open; snackbars for download notices + player errors (port of `NoticeSnackbars`).
- `AmbientBackground`: full-bleed `View` tinted with `accentInUse` at low opacity + two blurred `Image` copies of the cover (RN `Image` with `blurRadius` on Android; desktop falls back to a flat accent wash — no native blur dependency).

- [ ] **Step 3: `TrackRow` / `TrackList`**

`TrackRow` (209-line port): artwork 44 px, title + artist (+ explicit chip), duration, `Icon moreVert` menu with: **Play, Play next, Add to queue, Add to playlist…, ⭐ Favorite (toggle), Download (job progress ring), Download lyrics**. Long-press = same menu. Favourite state comes from `libraryStore.isFavorite(videoId)` (subscribed query).

`TrackList`: `FlatList` (`initialNumToRender` 12, `windowSize` 7) + `EmptyState`.

- [ ] **Step 4: Screens**

- **HomeScreen** — port of `HomePage.jsx`: “Recently played” horizontal `CardRow` (last 10 via `feedRepo`), “Suggested for you” shuffled grid with Play-all/Shuffle-all, refresh button (`RefreshControl` on `ScrollView` replaces the custom pull-to-refresh). Snapshot semantics preserved (feed reloads only on refresh).
- **SearchScreen** — port: debounced suggestions (`/search/suggestions`, 250 ms), filter chips `All|Songs|Videos|Albums|Artists|Playlists` (`/search?query&filter&limit=25`), results rendered as cards + `TrackList` for songs, `apiGet` cancellable via `AbortController` (same as web).
- **QueueScreen** — tabs `Queue | Related` (port of `QueueTab`/`RelatedTab`): queue list with swipe-free remove buttons + Clear queue; related list plays with `playTrack(track, related)`.
- **CollectionScreen** — port of `CollectionPage`: `/browsing/album/{id}` or `/playlists/{id}` (server playlists), header with artwork/meta/Play all/Shuffle, collapsible description (`LayoutAnimation`), `TrackList numbered` for albums.

- [ ] **Step 5: Wire routing + verify**

```bash
cd app && npm test && npm run typecheck && npm run bundle:android && npm run bundle:windows
git add -A && git commit -m "feat(shell): app shell, router and core screens"
```

---

### Task 20: Settings screen (appearance — lyrics provider lands in Task 25)

**Files:**
- Create: `app/src/screens/SettingsScreen.tsx`, `app/src/state/settingsStore.ts`

- [ ] **Step 1: `settingsStore.ts`** — hydrated from `settingsRepo`; exposes the same shape as Task 4's provider (mode/accent/font/adaptive + `lyricsProvider` placeholder, `apiBase?`).

- [ ] **Step 2: Screen (port of `SettingsPage.jsx`, MUI → primitives)**

- **Appearance**: color mode segmented control (Light/Dark/System), interface font selector (Alexandria/Cairo/System) with live preview card incl. Arabic sample, accent swatch grid (12 `ACCENTS`, check mark on selected), adaptive accent switch + colour readout, primary-accent preview row.
- **Downloads** (copy updated for the new pipeline): "Downloads save the original audio, the synced lyrics (.lrc) and the cover art into the app's private storage — no conversion, no tagging; songs play offline inside Carmen."
- **Credits** — Zaid Ballour + social chips (links open via `Linking.openURL`).

```bash
cd app && npm run typecheck && git add -A && git commit -m "feat(settings): appearance, downloads and credits sections"
```

---

## Phase 6 — Library (requirement 6)

### Task 21: Library screen with the four required views + sorting/filtering

**Files:**
- Create: `app/src/screens/LibraryScreen.tsx`, `app/src/components/{SegmentedTabs,SortMenu,PlaylistCard}.tsx`, `app/src/state/libraryStore.ts`
- Test: `app/src/state/libraryStore.test.ts` (sort/filter logic), `app/src/db/repos/tracks.test.ts` extensions

- [ ] **Step 1: Failing tests for the sort/filter semantics**

```ts
test.each<[SortKey, SortDir]>([['title','asc'],['title','desc'],['artist','asc'],['artist','desc'],['releaseDate','asc'],['releaseDate','desc']])(
  'songs sorted by %s %s', …);                      // fixtures with mixed case + missing release_date (NULLS last)
test('favoritesOnly restricts to favourites', …);
test('recent downloads returns latest 10 ordered by downloaded_at desc', …);
```

- [ ] **Step 2: `libraryStore.ts`**

```ts
interface LibraryState {
  section: 'playlists' | 'songs' | 'albums' | 'recent';
  setSection(s): void;                              // persisted to appState 'librarySection'
  playlists: Playlist[]; reloadPlaylists(): Promise<void>;
  createPlaylist(name): Promise<number>; renamePlaylist(id, name); deletePlaylist(id);
  togglePlaylistFavorite(id);
  songs: Track[]; sort: { key: SortKey; dir: SortDir }; favoritesOnly: boolean; search: string;
  setSort(key, dir); toggleFavoritesOnly(); setSearch(q); reloadSongs(): Promise<void>;
  albums: { album; artwork; count }[]; artists: { artist; artwork; count }[]; reloadGroups(): Promise<void>;
  recent: (Track & { downloadedAt })[]; reloadRecent(): Promise<void>;
  favorites: Set<string>; toggleFavorite(videoId): Promise<void>;
}
```

- All reads are real SQL through `tracks.ts`/`downloads.ts` repos (Task 7) — filtering/sorting happens in SQLite, not JS.

- [ ] **Step 3: `LibraryScreen.tsx` — 4 sections**

Top-level `SegmentedTabs`: **Playlists · Songs · Albums & Artists · Recent**.

1. **Playlists**: vertical `FlatList` of `PlaylistCard` (cover = first track's artwork or accent placeholder, name, track count, ⭐). Row actions: Rename / Delete (confirm dialog) / Play / Shuffle. **＋ New playlist** dialog (name + description). Tapping opens a playlist detail — reuse `CollectionScreen` with a local-DB source (`local` kind: reads `playlists.listTracks(id)`, same header layout with **Add songs** entry pointing at Songs section with a picker).
2. **Songs**: toolbar row — search input, `SortMenu` (Title / Release date / Artist × Ascending / Descending, `Icon sort`), **⭐ Favorites** quick toggle chip, **Play All** (filled pill) + **Shuffle All** (outlined pill) buttons; list = `listDownloadedSongs(query)`; each row: play, favorite, add-to-playlist, remove-download.
3. **Albums & Artists**: two sub-groups — horizontal chips/list; tapping an album → songs filtered by album (local), tapping an artist → songs filtered by artist.
4. **Recently Downloaded**: pinned **horizontal** strip of the last 10 (`listRecent(10)`) above the section content (also reachable as its own tab per requirement wording — implement as its own tab with the horizontal top strip + full list below).

- Play All / Shuffle All: `playerStore.playAll(songs, 0)`; shuffle = `toggleShuffle()` (on) + `playAll(shuffled(songs))` — matches web `CollectionPage` behavior.

- [ ] **Step 4: Verify → commit**

```bash
cd app && npm test && npm run typecheck
git add -A && git commit -m "feat(library): four-section view with sorting, favorites and play-all actions"
```

---

### Task 22: Playlist management & favourite flows wired into rows

**Files:**
- Create: `app/src/components/PlaylistPickerDialog.tsx`, `app/src/components/ConfirmDialog.tsx`
- Modify: `app/src/components/TrackRow.tsx` (menu additions from Task 19)

- [ ] **Step 1: `PlaylistPickerDialog`** — lists playlists with checkboxes; "Add to playlist(s)" writes `playlist_tracks` via `batch` (upsert stub tracks first); "New playlist and add" inline input; toast notice via `snackbars`.

- [ ] **Step 2: Favorite toggle** — `favorites.toggleFavorite` → optimistic `libraryStore.favorites` update → DB write; heart icon filled state; **Favorites filter** in Songs section reflects it (Task 21).

- [ ] **Step 3: Manual E2E checklist executed by running the app** (no browser testing):

```bash
cd app && npm run android     # or run-macos
# Manual checks (documented in DEVELOPMENT.md §Verification checklist):
#  create playlist → add song → favorite → sort songs → favorites filter → play all → shuffle
```

```bash
npm test && npm run typecheck && git add -A && git commit -m "feat(library): playlist picker, favorites and row actions"
```

---

## Phase 7 — Redesigned player experience (requirement 3)

### Task 23: Now Playing screen — sleek responsive redesign

**Files:**
- Create: `app/src/screens/NowPlayingScreen.tsx`, `app/src/components/{PlayerControls,SeekBar,MiniPlayer,QueuePanel,RelatedPanel}.tsx`
- Modify: `app/src/navigation/Router.tsx` (nowPlaying presentation)

- [ ] **Step 1: Layout contract (responsive, two form factors)**

- **Mobile (< 900 px or android/ios):** full-screen route pushed above the shell. Structure top→down: drag-handle/close header (collapse → pop), large square artwork with soft shadow + ambient tint behind, title/artist block (explicit chip), `SeekBar`, `PlayerControls`, icon tab strip **Lyrics · Related · Queue** with the panel below (port of the web sheet's tab logic: `tab = null` until tapped), utility row (download, player menu: Go to artist / Go to album / Download lyrics).
- **Desktop (≥ 900 px, non-android):** two-pane route rendered *inside* the shell (MiniPlayer hides): left pane — artwork (max 420 px, square), metadata, seek + transport + repeat/shuffle, volume-free (OS mixer owns loudness, same rule as web); right pane — the same three tabs as persistent panels with a visible header (matches web's `isDesktop ? RELATED_TAB : null` default), plus a close (pop) button.
- Spacing/typography tokens from `theme.tokens` (radius pill buttons, 600-weight titles); `useWindowDimensions` drives the switch — no media queries needed.

- [ ] **Step 2: `SeekBar` with smooth motion (no re-render per frame)**

- Engine ticks arrive at ≥5 Hz (`Audio:time`). `SeekBar` keeps an `Animated.Value(positionMs)`; on each tick it ` Animated.timing(value, { toValue: nextMs, duration: tickMs, useNativeDriver: false })` — the bar glides between ticks instead of stepping.
- Interaction: `PanResponder` on the track (works on every platform — no gesture-handler): on grant → `panX` state takes over (value follows finger), on release → `playerStore.seek(sec)`; buffered portion drawn as a second bar using `buffered`.
- Time labels `formatTime(currentTime)` / `-formatTime(duration - currentTime)`.

- [ ] **Step 3: `PlayerControls`** — shuffle · previous · **play/pause (72 px filled pill, accent)** · next · repeat (off/all/one with `repeatOne` badge); press states via `Pressable` style function; `Icon` glyphs; accessibility labels carried over (`aria` → `accessibilityLabel`/`accessibilityRole`).

- [ ] **Step 4: `MiniPlayer`** — 64 px bar: 40 px artwork, title/artist marquee-lite (single line, ellipsis), play/pause + next, thin progress line on top edge; tap → `push({name:'nowPlaying'})`; visible on every root route whenever `player.current` exists and `nowPlaying` isn't open.

- [ ] **Step 5: Verify + commit**

```bash
cd app && npm run typecheck && npm run bundle:android && npm run bundle:macos
git add -A && git commit -m "feat(player): redesigned now playing screen for desktop and mobile"
```

---

### Task 24: Lyrics panel — synced highlight that follows, tap-to-seek, offline `.lrc`

**Files:**
- Create: `app/src/components/LyricsPanel.tsx`
- Test: `app/src/services/lyricsService.test.ts` (offline parsing cases)

- [ ] **Step 1: Lyrics resolution order** (`playbackService` precomputes `currentLyrics`)

1. Online: `meta.lyrics.synced` / `meta.lyrics.unsynced` (+ `source` caption) — as the web app does.
2. Offline (downloaded track, no network or meta failed): read `<dir>/lyrics.lrc` → `parseLrc`, or `lyrics.txt` → unsynced (requirement 4: lyrics ship with the download).
3. Neither → "No lyrics available for this song" empty state with track title.

- [ ] **Step 2: `LyricsPanel.tsx` behavior (port of `LyricsView.jsx`, react-lrc replaced by RN code)**

```tsx
// Active-line derivation: a selector over playerStore.currentTime —
//   binary search over lines[].timeMs; only recomputes when the index changes
//   (one state update per line, not per frame — same trick as the web app).
// Rendering: ScrollView with all lines (lyrics are short — no virtualization needed);
//   active line: accent colour, 600 weight, 1.15–1.3 rem scale, NO highlight box;
//   past lines opacity .42, future .3, colour+opacity transition 150 ms (Animated).
// Follow: when active index changes → scrollTo({ y: lineY - viewport/2 + lineH/2, animated: true })
//   lineY from measured onLayout positions (cached in a ref). User scroll sets
//   `userPausedUntil = Date.now() + 5000`; following resumes after that (port of
//   useRecoverAutoScrollImmediately semantics).
// Tap a line → playerStore.seek(line.timeMs/1000) + resume following immediately.
// Unsynced fallback: centered pre-line text, fade-in, source caption at the bottom.
// Empty: centered empty state.
```

- `requestAnimationFrame` loop is **not** used (unlike web) — the panel derives from store ticks (≥5 Hz), so highlight latency ≤ 200 ms and there is no idle frame loop burning CPU.

- [ ] **Step 3: Tests for `parseLrc` edge cases already added in Task 3** — extend with the `.lrc` fixtures written by the download service (round-trip: `toLrc(parseLrc(x))`).

```bash
cd app && npm test && npm run typecheck
git add -A && git commit -m "feat(lyrics): synced panel with follow, seek and offline lrc"
```

---

## Phase 8 — Lyrics Provider setting (requirement 7) + server support

### Task 25: Lyrics Provider selector in Settings (default "Auto")

**Files:**
- Modify: `app/src/state/settingsStore.ts`, `app/src/screens/SettingsScreen.tsx`
- Modify: `app/src/services/api.ts` (provider param on track fetch), `app/src/services/playbackService.ts` (pass provider when requesting `/browsing/track/`)
- Test: `app/src/services/api.test.ts`

- [ ] **Step 1: Define the option list**

```ts
// app/src/state/settingsStore.ts
export const LYRICS_PROVIDERS = [
  { id: 'auto',       label: 'Auto',       hint: 'YouTube first, then the best public source' },
  { id: 'lrclib',     label: 'LRCLIB' },
  { id: 'musixmatch', label: 'Musixmatch' },
  { id: 'netease',    label: 'NetEase' },
  { id: 'megalobiz',  label: 'Megalobiz' },
  { id: 'genius',     label: 'Genius' },
] as const;
export type LyricsProviderId = (typeof LYRICS_PROVIDERS)[number]['id'];
// persisted via settingsRepo key 'lyricsProvider', DEFAULT = 'auto'
```

- [ ] **Step 2: Settings UI section** — `Section "Lyrics"` above Downloads: list rows with radio check (`Icon check` on the selected row, `Auto` first with its hint), change → `settingsStore.setLyricsProvider(id)` → immediate write to `settingsRepo`.

- [ ] **Step 3: API plumbing**

```ts
// api.ts — extend track fetch
export async function getTrackMeta(videoId: string, provider?: LyricsProviderId): Promise<TrackMeta> {
  return apiGet<TrackMeta>(`/browsing/track/${videoId}`, provider && provider !== 'auto' ? { provider } : {});
}
// playbackService uses getTrackMeta(current.videoId, settingsStore.getState().lyricsProvider)
```

- [ ] **Step 4: Test** — `api.test.ts` (mock fetch): `provider: 'auto'`/undefined → no `provider` query key; `'lrclib'` → `?provider=lrclib`. Run `npm test` → green.

```bash
git add -A && git commit -m "feat(settings): lyrics provider selector with auto default"
```

---

### Task 26: Server: thread `provider` through the track endpoint

**Files:**
- Modify: `server/core.py` (`get_track`, `_collect_lyrics`, `_syncedlyrics_lrc`), `server/routes/browsing.py` (track route)

- [ ] **Step 1: `_syncedlyrics_lrc` accepts a provider whitelist**

```python
LYRICS_PROVIDERS = {
    "lrclib": "Lrclib", "musixmatch": "Musixmatch", "netease": "NetEase",
    "megalobiz": "Megalobiz", "genius": "Genius",
}

def _syncedlyrics_lrc(title, artist, album, duration, provider: str | None = None):
    ...
    providers = [LYRICS_PROVIDERS[provider]] if provider else []
    ...
    lrc = syncedlyrics.search(query, synced_only=True, providers=providers)
    # when provider == 'genius' (plain-only source) fall back to synced_only=False
```

- [ ] **Step 2: `provider` flows through `_collect_lyrics` → `get_track`**

Semantics (document in the docstrings):
- `provider` absent/`auto` → **current 3-step chain unchanged** (YouTube timed → YouTube plain → syncedlyrics multi-provider).
- `provider=<name>` → skip the YouTube lyrics browse entirely and use **only** the named provider via `syncedlyrics.search(..., providers=[Name])` (synced first, plain fallback for Genius).

```python
def _collect_lyrics(browse_id, title="", artist="", album="", duration=None, provider: str | None = None):
    lyrics = {"browseId": browse_id, "synced": None, "unsynced": None, "source": None}
    if provider:
        lrc = _syncedlyrics_lrc(title, artist, album, duration, provider=provider)
        if lrc:
            lines = _parse_lrc(lrc)
            if lines:
                lyrics["synced"] = lines
                lyrics["source"] = LYRICS_PROVIDERS[provider]
        if not lyrics["unsynced"] and lyrics["synced"]:
            lyrics["unsynced"] = "\n".join(l["text"] for l in lyrics["synced"])
        return lyrics
    # … existing browse_id / plain / fallback chain …
```

- [ ] **Step 3: Route accepts the query param** (keep decorator order `@sanitized` then `@cached` per AGENTS.md; `@cached` hashes kwargs so the cache key namespaces by provider automatically):

```python
@router.get("/track/{videoId}", summary="Get Enriched Track", …)
@sanitized
@cached("track", ttl=3600)
async def track(videoId: str, provider: str | None = None):
    """
    …
    - **provider**: force a lyrics provider — one of ``lrclib, musixmatch,
      netease, megalobiz, genius``. Omitted or ``auto`` = default chain.
    """
    if provider is not None:
        provider = provider.lower()
        if provider == "auto":
            provider = None
        elif provider not in LYRICS_PROVIDERS:
            raise HTTPException(status_code=400, detail=f"Unknown lyrics provider: {provider}")
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(executor, partial(get_track, videoId, provider))
    except DurationLimitExceeded as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

(`get_track(video_id, provider=None)` passes `provider=provider` into `_collect_lyrics` at its existing call site, line ~721.)

- [ ] **Step 4: Verify server still boots + lints**

```bash
./venv/bin/python -c "from server import core, routes; print('import ok')"
./venv/bin/python -m ruff check server/ || true
# functional check (Redis + browser.json required):
curl -s 'http://localhost:8000/docs' >/dev/null && \
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8000/browsing/track/<someVideoId>?provider=lrclib'   # expect 200
```

```bash
git add server/ && git commit -m "feat(lyrics): optional provider param on the enriched track endpoint"
```

---

## Phase 9 — CI/CD (requirement 8)

### Task 27: `ci.yml` — quality gate (no browser tooling)

**Files:**
- Create: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  check:
    runs-on: ubuntu-24.04
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: app/package-lock.json }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test -- --ci --coverage=false
      # Metro must be able to bundle for every target — catches broken imports per platform
      - run: npm run bundle:android
      - run: npm run bundle:windows
      - run: npm run bundle:macos
      - run: npm run bundle:linux
      # Requirement 4: no conversion/tagging dependencies anywhere in the app
      - name: No ffmpeg / ID3 tagging
        run: |
          if grep -rniE "ffmpeg|browser-id3-writer|ID3Writer|libmp3lame" src/ modules/ package.json; then
            echo "conversion/tagging dependency found"; exit 1
          fi
```

```bash
git add .github/workflows/ci.yml && git commit -m "ci: typecheck, tests, four-platform bundles and no-conversion gate"
```

---

### Task 28: `android.yml` — production APK + AAB with keystore signing

**Files:**
- Create: `.github/workflows/android.yml`
- Modify: `app/android/app/build.gradle` (signing config), create `app/android/keystore.properties.example`

- [ ] **Step 1: Gradle signing block** (`app/android/app/build.gradle`):

```gradle
def keystoreProps = new Properties()
def keystorePropsFile = rootProject.file('keystore.properties')
if (keystorePropsFile.exists()) keystoreProps.load(new FileInputStream(keystorePropsFile))

android {
    signingConfigs {
        release {
            if (keystoreProps['storeFile']) {
                storeFile file(keystoreProps['storeFile'])
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            signingConfig keystoreProps['storeFile'] ? signingConfigs.release : signingConfigs.debug
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

`keystore.properties.example` documents `storeFile=../upload-keystore.jks`, `storePassword=…`, `keyAlias=upload`, `keyPassword=…` (**`keystore.properties` and `*.jks` gitignored**).

- [ ] **Step 2: workflow**

```yaml
name: Android Release
on:
  push: { tags: ['v*'] }
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-24.04
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: app/package-lock.json }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 17 }
      - run: npm ci
      - name: Decode keystore
        env:
          ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: |
          if [ -n "$ANDROID_KEYSTORE_BASE64" ]; then
            echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > android/upload-keystore.jks
            cat > android/keystore.properties <<EOF
          storeFile=../upload-keystore.jks
          storePassword=${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          keyAlias=${{ secrets.ANDROID_KEY_ALIAS }}
          keyPassword=${{ secrets.ANDROID_KEY_PASSWORD }}
          EOF
          fi
      - name: Build APK + AAB   # signing props come from keystore.properties written above
        run: cd android && ./gradlew assembleRelease bundleRelease
      - uses: actions/upload-artifact@v4
        with:
          name: carmen-android
          path: |
            app/android/app/build/outputs/apk/release/*.apk
            app/android/app/build/outputs/bundle/release/*.aab
```

- [ ] **Step 3: Local pre-flight** (this machine has SDK + JDK 17):

```bash
cd app/android && ./gradlew assembleRelease -q && ls app/build/outputs/apk/release/
```

- [ ] **Step 4: Commit** — `git commit -m "ci(android): signed release apk and aab with keystore secrets"`.

**Required GitHub secrets:** `ANDROID_KEYSTORE_BASE64` (base64 of the `.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Generation command documented in DEVELOPMENT.md (keytool line below).

---

### Task 29: `windows.yml` — MSBuild Release → MSIX/AppX artifact

```yaml
name: Windows Release
on:
  push: { tags: ['v*'] }
  workflow_dispatch:
jobs:
  build:
    runs-on: windows-latest
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: app/package-lock.json }
      - run: npm ci
      - name: Add Windows platform   # windows/ is committed; idempotent re-init keeps CI resilient
        run: npx react-native-windows-init --overwrite --version 0.83.2 || true
      - uses: microsoft/setup-msbuild@v2
      - name: MSBuild Release x64
        shell: pwsh
        run: |
          msbuild windows\Carmen.sln /p:Configuration=Release /p:Platform=x64 `
                /p:AppxPackageSigningEnabled=false /m /v:m
      - uses: actions/upload-artifact@v4
        with: { name: carmen-windows-x64, path: windows/AppPackages/** }
      # Optional production signing — gated via env (the `secrets` context is
      # not reliably readable in step-level `if`, so detect it in the shell):
      - name: Sign package
        shell: pwsh
        env:
          WINDOWS_CERT_BASE64: ${{ secrets.WINDOWS_CERT_BASE64 }}
          WINDOWS_CERT_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
        run: |
          if ([string]::IsNullOrEmpty($env:WINDOWS_CERT_BASE64)) { Write-Host "No cert secret — skipping signing"; exit 0 }
          [IO.File]::WriteAllBytes("$env:RUNNER_TEMP\cert.pfx", [Convert]::FromBase64String($env:WINDOWS_CERT_BASE64))
          $signtool = (Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe" | Select-Object -First 1).FullName
          Get-ChildItem -Recurse windows\AppPackages\*.msix | ForEach-Object {
            & $signtool sign /f "$env:RUNNER_TEMP\cert.pfx" /p $env:WINDOWS_CERT_PASSWORD /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $_.FullName
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
          }
```

Note: if `windows/` regeneration on the runner reveals that local commits drift from `react-native-windows-init`, keep `windows/` fully committed (it is generated once locally in Task 6's sibling step and then never regenerated — the init step above is only for fresh checkouts missing the folder). Secrets: `WINDOWS_CERT_BASE64`, `WINDOWS_CERT_PASSWORD` (optional).

```bash
git add .github/workflows/windows.yml && git commit -m "ci(windows): msbuild release package with optional signing"
```

---

### Task 30: `macos.yml` — xcodebuild archive → .app/.pkg artifact

```yaml
name: macOS Release
on:
  push: { tags: ['v*'] }
  workflow_dispatch:
jobs:
  build:
    runs-on: macos-14
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: app/package-lock.json }
      - run: npm ci
      - name: CocoaPods
        run: pod install --project-directory=macos
      - name: Build release .app
        run: |
          xcodebuild -workspace macos/Carmen.xcworkspace -scheme Carmen \
            -configuration Release -derivedDataPath build \
            CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO build
      - name: Package .pkg (productbuild, unsigned)
        run: |
          mkdir -p dist
          app=$(find build/Build/Products/Release -maxdepth 1 -name '*.app' | head -1)
          productbuild --component "$app" /Applications --sign - dist/Carmen.pkg || \
          tar -czf dist/Carmen-macos.tar.gz -C "$(dirname "$app")" "$(basename "$app")"
      - uses: actions/upload-artifact@v4
        with: { name: carmen-macos, path: app/dist/* }
      # Optional: Developer ID signing + notarization when secrets exist
      #   secrets: MACOS_CERT_P12_BASE64, MACOS_CERT_PASSWORD, MACOS_NOTARY_PROFILE
```

```bash
git add .github/workflows/macos.yml && git commit -m "ci(macos): xcodebuild release artifact with ad-hoc signing"
```

---

### Task 31: `linux.yml` — GTK4/CMake build → .deb + tar.gz

**Prerequisite:** `app/linux` exists (Task 6/9 bindings live there; the folder is generated from the pinned `@lucid-softworks/react-native-linux` template — see `app/scripts/setup-linux.sh` which clones their repo at a pinned commit and runs their `init-linux` CLI, or copies `template/linux` into place; **run this once inside the CI job or a Lima VM** since GTK4 cannot be built on this macOS host).

```yaml
name: Linux Release
on:
  push: { tags: ['v*'] }
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-24.04          # their CI baseline
    defaults: { run: { working-directory: app } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: app/package-lock.json }
      - name: GTK4 + media toolchain
        run: |
          sudo apt-get update
          sudo apt-get install -y build-essential cmake ninja-build pkg-config \
            libgtk-4-dev libsoup-3.0-dev libsqlite3-dev libfontconfig1-dev \
            libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
            gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly gstreamer1.0-libav
      - run: npm ci
      - name: Ensure linux shell
        run: bash scripts/setup-linux.sh        # pinned rn-linux template → app/linux
      - name: Bundle JS for linux
        run: npm run bundle:linux
      - name: Configure + build
        run: |
          cmake --preset release -S linux -B linux/build
          cmake --build linux/build --config Release
      - name: Package
        run: |
          mkdir -p dist
          cp -r linux/build/dist/carmen/* dist/ || cp -r linux/build/carmen dist/
          tar -czf dist/carmen-linux-x86_64.tar.gz -C dist --exclude='*.tar.gz' .
          # .deb via cpack when the template exports a CPack config:
          (cd linux/build && cpack -G DEB) && cp linux/build/*.deb dist/ || true
      - uses: actions/upload-artifact@v4
        with: { name: carmen-linux, path: app/dist/* }
```

Risk note (explicit): rn-linux is **alpha** — this job is the acceptance test for the Linux target. If the pinned template fails to build a feature we depend on, the fallback order is: (1) pin an older/newer rn-linux commit, (2) move our native bindings out of their ad-hoc table into their documented `docs/native-modules.md` mechanism, (3) last resort — ship Linux via the GTK shell of the same bundle and record the deviation in DEVELOPMENT.md. Do **not** silently swap Linux to a webview runtime (that would violate requirement 1).

```bash
git add .github/ app/scripts/setup-linux.sh && git commit -m "ci(linux): gtk4 cmake build with deb and tarball artifacts"
```

---

## Phase 10 — Documentation & final verification

### Task 32: `DEVELOPMENT.md` (requirement 9)

**Files:** Create `DEVELOPMENT.md` (repo root)

- [ ] **Step 1: Write the guide** with exactly these sections (each step a copy-pasteable command):

```markdown
# Carmen — Cross-Platform Development Guide
## 0. What lives where
   (app/ RN TS · modules/ native bridges · frontend/ legacy web · server/ FastAPI)
## 1. Prerequisites
   - Common: Node ≥20, npm, Git
   - Android: JDK 17, Android SDK + emulator (ANDROID_HOME), `sdkmanager "platforms;android-35"`
   - macOS: Xcode 15+/CLT, CocoaPods
   - Windows: Visual Studio 2022 (UWP + C++ workloads), Windows 10 SDK
   - Linux: Ubuntu 24.04, apt packages (exact list from linux.yml)
## 2. Install & verify (any platform)
   cd app && npm install && npm run typecheck && npm test
## 3. Running locally
   - Metro: `cd app && npm start`
   - Android:  `npm run android`
   - macOS:    `npm run macos`
   - Windows:  `npm run windows`
   - Linux:    `bash scripts/setup-linux.sh && cmake --preset dev -S linux -B linux/build && cmake --build linux/build`
   - Backend:  `./venv/bin/python -m server`  (browser.json + Redis required)
   - API base: edit app/env.json → {"apiBase": "http://<host>:8000"}
## 4. Building release binaries
   (per-platform commands from Tasks 28–31 + local equivalents incl. gradlew assembleRelease)
## 5. Android signing
   keytool -genkeypair -v -keystore upload-keystore.jks -alias upload \
           -keyalg RSA -keysize 4096 -validity 10000
   base64 -i upload-keystore.jks | pbcopy        # → secret ANDROID_KEYSTORE_BASE64
   GitHub secrets table: ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD
   (+ optional WINDOWS_CERT_*, MACOS_CERT_*)
## 6. Architecture tour
   native facades → db driver → repos → stores → services → screens/components
   (the "separation of concerns" map, one paragraph each layer)
## 7. Offline download layout
   <documents>/songs/<videoId>/{audio.m4a, artwork.jpg, lyrics.lrc}
## 8. Verification checklist (manual, on-device — NO browser tests are used)
   [ ] close window → tray icon → audio continues → reopen → same route
   [ ] restart app → queue restored, position restored, press play resumes
   [ ] airplane mode → downloaded song plays, controls show local cover/title
   [ ] library: create/add/favorite/sort/filter/play-all/shuffle
   [ ] settings: lyrics provider persists and changes lyrics source
## 9. Troubleshooting
   (Windows module not autolinked · Linux font registration via FcConfigAppFontAddFile ·
    cleartext HTTP on Android · bun ≤1.3.14 constraint applies to the server only)
```

- [ ] **Step 2: Commit** — `git commit -m "docs: cross-platform development guide"`.

---

### Task 33: Final verification sweep (evidence before claims)

- [ ] **Step 1: Quality gates**

```bash
cd app
npm run typecheck                 # expect: 0 errors
npm test                          # expect: all green
grep -rniE "ffmpeg|browser-id3-writer|ID3Writer" src/ modules/ package.json ; echo "exit=$?"   # expect exit=1 (no matches)
git status --porcelain frontend/  # expect: empty (legacy web untouched)
```

- [ ] **Step 2: Platform bundles (all four + android)**

```bash
npm run bundle:android && npm run bundle:windows && npm run bundle:macos && npm run bundle:linux
# each: "Wrote … bundle …" with no resolution errors
```

- [ ] **Step 3: Native builds available on this machine**

```bash
cd android && ./gradlew assembleRelease        # expect BUILD SUCCESSFUL (SDK+JDK17 present)
# macOS: xcodebuild -workspace macos/Carmen.xcworkspace -scheme Carmen -configuration Release build  (if Xcode installed; else CI)
```

- [ ] **Step 4: Server check** — `./venv/bin/python -c "from server import core, routes; print('ok')"` + `ruff check server/`.

- [ ] **Step 5: Requirements traceability** (tick each against evidence — workflow run URL / test name / file):

| # | Requirement | Evidence |
|---|---|---|
| 1 | RN + TS, 4 platforms, no browser testing | `app/` tsconfig; `windows|macos|linux|android`; zero Playwright/Selenium/Cypress deps (`grep`) |
| 2 | Close→tray, route restore | Task 17 native intercepts + `desktopLifecycle.test.ts` + on-device checklist |
| 3 | Redesigned Now Playing, smooth lyrics/controls | Task 23/24 |
| 4 | Bundled fonts/icons; no ffmpeg/tagging; raw audio+lrc+artwork; offline playback; local media metadata | Tasks 2/10/11 + `downloadService.test.ts` + offline checklist |
| 5 | SQLite playlists/favorites + playback state restore | Tasks 5–7 + repo tests + `playerStore.hydrate` |
| 6 | 4-section Library, sorting/filters, favorites, Play/Shuffle All | Tasks 21–22 + tests |
| 7 | Lyrics Provider, Auto default | Tasks 25–26 |
| 8 | CI for Android/Win/macOS/Linux + keystore signing | Tasks 27–31 |
| 9 | DEVELOPMENT.md | Task 32 |

- [ ] **Step 6: Final commit**

```bash
git add -A && git commit -m "chore: final verification sweep for cross-platform conversion"
```

---

## Execution notes

- **Commit style:** conventional (`feat(...)`, `fix(...)`, `ci(...)`, `docs(...)`) — matches existing git log.
- **Phase order is dependency-correct**; each phase ends compilable and committed. Do not start a phase before its prerequisite phase's verification step passes.
- **Where this machine can verify:** typecheck, jest, all Metro bundles, Android Gradle build, macOS Xcode build (if Xcode present), server import. **Where CI verifies:** Windows, Linux, artifact signing.
- **Known risks & owners:** rn-linux alpha (Task 31 fallback ladder), RNW close-intercept plumbing (Task 17 Step 3 has a documented fallback), desktop `.webm` playback (Task 10 extension rule + engine error message).
- **Out of scope (explicit):** iOS target, browser/E2E test tooling, changes to `frontend/` behavior, server-side audio conversion (never existed — verified).
