import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CssBaseline, ThemeProvider as MuiThemeProvider } from '@mui/material';

import { updateSettings, useSettings } from '../settings/store';
import { DEFAULT_ACCENT, DEFAULT_FONT, buildTheme } from '../theme';
import type { FontId, ThemeMode } from '../types/models';

/** What {@link useTheme} answers — one entry per theme engine setting. */
export interface ThemeContextValue {
  /** Chosen mode; `system` follows `prefers-color-scheme` live. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Accent chosen in Settings. */
  accent: string;
  setAccent: (accent: string) => void;
  /** The accent the theme actually wears (adaptive wins while it has one). */
  accentInUse: string;
  adaptiveAccent: boolean;
  setAdaptiveAccent: (enabled: boolean) => void;
  /** Colour read out of the playing cover — session state, never persisted. */
  adaptiveColor: string | null;
  setAdaptiveColor: (color: string | null) => void;
  font: FontId;
  setFont: (font: FontId) => void;
  /** `mode` resolved against the system preference (`light` or `dark`). */
  resolved: 'light' | 'dark';
}

/**
 * Theme engine: light / dark / system modes, an accent color (manually
 * picked, or taken from the cover of the song that is playing when
 * "Adaptive accent color" is on) and the interface font.  The choice lives
 * in the settings store (SQLite, hydrated in `main.tsx` before the first
 * render) and the system mode follows `prefers-color-scheme` live.
 */
const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { themeMode: mode, accent, adaptiveAccent, font } = useSettings();
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  // Colour read out of the playing song's cover — session state, because it
  // is re-derived from the artwork every time a track starts (see
  // theme/adaptiveAccent.ts).
  const [adaptiveColor, setAdaptiveColor] = useState<string | null>(null);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    updateSettings({ themeMode: next });
  }, []);

  const setAccent = useCallback((next: string) => {
    updateSettings({ accent: next });
  }, []);

  const setFont = useCallback((next: FontId) => {
    updateSettings({ font: next });
  }, []);

  const setAdaptiveAccent = useCallback((next: boolean) => {
    updateSettings({ adaptiveAccent: Boolean(next) });
  }, []);

  // Switching adaptive off goes back to the accent picked in Settings
  // straight away, whoever flipped the switch.
  useEffect(() => {
    if (!adaptiveAccent) setAdaptiveColor(null);
  }, [adaptiveAccent]);

  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  // Adaptive only wins while it is switched on *and* a cover has actually
  // been read; otherwise the accent chosen in Settings is what the app wears.
  const accentInUse = adaptiveAccent && adaptiveColor ? adaptiveColor : accent;

  const theme = useMemo(
    () => buildTheme(resolved, accentInUse, font),
    [resolved, accentInUse, font],
  );

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', accentInUse);
  }, [accentInUse]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      accent,
      setAccent,
      accentInUse,
      adaptiveAccent,
      setAdaptiveAccent,
      adaptiveColor,
      setAdaptiveColor,
      font,
      setFont,
      resolved,
    }),
    [
      mode,
      setMode,
      accent,
      setAccent,
      accentInUse,
      adaptiveAccent,
      setAdaptiveAccent,
      adaptiveColor,
      setAdaptiveColor,
      font,
      setFont,
      resolved,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
