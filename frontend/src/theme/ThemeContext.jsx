import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CssBaseline, ThemeProvider as MuiThemeProvider } from '@mui/material';
import { DEFAULT_ACCENT, DEFAULT_FONT, buildTheme } from '../theme';

/**
 * Theme engine: light / dark / system modes, an accent color (manually
 * picked, or taken from the cover of the song that is playing when
 * "Adaptive accent color" is on) and the interface font.  The choice is
 * persisted in localStorage and the system mode follows
 * `prefers-color-scheme` live.
 */
const ThemeContext = createContext(null);

const STORAGE_MODE = 'carmen:themeMode';
const STORAGE_ACCENT = 'carmen:accent';
const STORAGE_ADAPTIVE = 'carmen:adaptiveAccent';
// v2 key: Alexandria is the project font for both scripts, so an older
// `carmen:font` / `samma3ni:font` choice is deliberately not carried over.
const STORAGE_FONT = 'carmen:font.v2';

/** Pre-rename keys, still read once so the saved settings survive. */
const LEGACY_KEYS = {
  [STORAGE_MODE]: 'samma3ni:themeMode',
  [STORAGE_ACCENT]: 'samma3ni:accent',
};

function readStorage(key, fallback) {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) return stored;
    const legacy = LEGACY_KEYS[key] && window.localStorage.getItem(LEGACY_KEYS[key]);
    if (legacy) {
      window.localStorage.setItem(key, legacy);
      return legacy;
    }
  } catch {
    /* private mode */
  }
  return fallback;
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function systemPrefersDark() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => readStorage(STORAGE_MODE, 'system'));
  const [accent, setAccentState] = useState(() => readStorage(STORAGE_ACCENT, DEFAULT_ACCENT));
  const [font, setFontState] = useState(() => readStorage(STORAGE_FONT, DEFAULT_FONT));
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [adaptiveAccent, setAdaptiveState] = useState(
    () => readStorage(STORAGE_ADAPTIVE, '0') === '1',
  );
  // Colour read out of the playing song's cover — session state, because it
  // is re-derived from the artwork every time a track starts (see
  // theme/adaptiveAccent.js).
  const [adaptiveColor, setAdaptiveColor] = useState(null);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const setMode = useCallback((next) => {
    setModeState(next);
    writeStorage(STORAGE_MODE, next);
  }, []);

  const setAccent = useCallback((next) => {
    setAccentState(next);
    writeStorage(STORAGE_ACCENT, next);
  }, []);

  const setFont = useCallback((next) => {
    setFontState(next);
    writeStorage(STORAGE_FONT, next);
  }, []);

  const setAdaptiveAccent = useCallback((next) => {
    const enabled = Boolean(next);
    setAdaptiveState(enabled);
    writeStorage(STORAGE_ADAPTIVE, enabled ? '1' : '0');
    // switching it off goes back to the accent picked above straight away
    if (!enabled) setAdaptiveColor(null);
  }, []);

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

  const value = useMemo(
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

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
