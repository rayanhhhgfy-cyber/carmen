import { Appearance } from 'react-native';
import { create } from 'zustand';

import { DEFAULT_ACCENT, DEFAULT_FONT, type ThemeMode } from '../theme/tokens';

/**
 * Where persisted settings are read from and written to.
 *
 * The default is an in-memory Map (good enough before anything is persisted
 * for real); `setSettingsPersistence` swaps in the SQLite `settingsRepo`
 * once it exists — same shape as the web app's localStorage reads/writes in
 * `ThemeContext.jsx`, just asynchronous.
 */
export interface SettingsPersistence {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Storage keys, exactly as the web app's `ThemeContext.jsx` names them
 * (the web keys carry a `carmen:` localStorage prefix; the native settings
 * table needs no namespace).  Values are stored raw, the way the web app
 * stores them — '0'/'1' for the adaptive-accent boolean.
 */
export const SETTINGS_KEYS = {
  mode: 'themeMode',
  accent: 'accent',
  adaptiveAccent: 'adaptiveAccent',
  font: 'font',
} as const;

/** Default persistence: a Map that lives for the session. */
class InMemorySettingsPersistence implements SettingsPersistence {
  private readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

export function createInMemoryPersistence(): SettingsPersistence {
  return new InMemorySettingsPersistence();
}

let persistence: SettingsPersistence = createInMemoryPersistence();

/** Swap in the real repository (wired up once Task 7's repo exists). */
export function setSettingsPersistence(impl: SettingsPersistence): void {
  persistence = impl;
}

/** Anything but a known mode falls back to the default: 'system'. */
function parseMode(raw: string | null): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/** `resolved` computation, kept here so it is testable without rendering. */
export function deriveResolved(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  // The web app: `mode === 'system' ? (systemDark ? 'dark' : 'light') : mode`.
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}

/** Fire-and-forget write; the web app's `writeStorage` swallows failures too. */
function persist(key: string, value: string): void {
  try {
    void persistence.set(key, value).catch(() => undefined);
  } catch {
    /* private mode / read-only storage */
  }
}

let watchingAppearance = false;

export interface SettingsState {
  hydrated: boolean;
  mode: ThemeMode;
  accent: string;
  font: string;
  adaptiveAccent: boolean;
  /** The OS colour scheme, followed live while `mode` is 'system'. */
  systemDark: boolean;
  resolved: 'light' | 'dark';
  /** Read every persisted key (defaults when nothing is stored). */
  hydrate(): Promise<void>;
  setMode(mode: ThemeMode): void;
  setAccent(accent: string): void;
  setFont(font: string): void;
  setAdaptiveAccent(enabled: boolean): void;
  /** Feed a system scheme change in; the Appearance listener calls this. */
  setSystemDark(dark: boolean): void;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  hydrated: false,
  // Defaults while unhydrated — they mirror what `hydrate` answers when
  // storage holds nothing (the web app's `readStorage(key, fallback)`).
  mode: 'system',
  accent: DEFAULT_ACCENT,
  font: DEFAULT_FONT,
  adaptiveAccent: false,
  systemDark: false,
  resolved: 'light',

  hydrate: async () => {
    let stored: [string | null, string | null, string | null, string | null] = [
      null,
      null,
      null,
      null,
    ];
    try {
      stored = await Promise.all([
        persistence.get(SETTINGS_KEYS.mode),
        persistence.get(SETTINGS_KEYS.accent),
        persistence.get(SETTINGS_KEYS.adaptiveAccent),
        persistence.get(SETTINGS_KEYS.font),
      ]);
    } catch {
      /* unreadable storage → the defaults, exactly like the web app */
    }
    const [modeRaw, accentRaw, adaptiveRaw, fontRaw] = stored;

    const mode = parseMode(modeRaw || 'system');
    const accent = accentRaw || DEFAULT_ACCENT;
    const font = fontRaw || DEFAULT_FONT;
    const adaptiveAccent = (adaptiveRaw || '0') === '1';
    const systemDark = Appearance.getColorScheme() === 'dark';

    set({
      mode,
      accent,
      font,
      adaptiveAccent,
      systemDark,
      resolved: deriveResolved(mode, systemDark),
      hydrated: true,
    });

    // System mode follows `Appearance` live — the RN equivalent of the web
    // app's `matchMedia('(prefers-color-scheme: dark)')` change listener.
    if (!watchingAppearance) {
      watchingAppearance = true;
      Appearance.addChangeListener((preferences) => {
        get().setSystemDark(preferences.colorScheme === 'dark');
      });
    }
  },

  setMode: (mode) => {
    set({ mode, resolved: deriveResolved(mode, get().systemDark) });
    persist(SETTINGS_KEYS.mode, mode);
  },

  setAccent: (accent) => {
    set({ accent });
    persist(SETTINGS_KEYS.accent, accent);
  },

  setFont: (font) => {
    set({ font });
    persist(SETTINGS_KEYS.font, font);
  },

  setAdaptiveAccent: (enabled) => {
    set({ adaptiveAccent: enabled });
    persist(SETTINGS_KEYS.adaptiveAccent, enabled ? '1' : '0');
  },

  setSystemDark: (dark) => {
    set({ systemDark: dark, resolved: deriveResolved(get().mode, dark) });
  },
}));
