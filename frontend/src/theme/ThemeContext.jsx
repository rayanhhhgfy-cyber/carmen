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
 * Theme engine: light / dark / system modes, an accent color and the
 * interface font.  The choice is persisted in localStorage and the system
 * mode follows `prefers-color-scheme` live.
 */
const ThemeContext = createContext(null);

const STORAGE_MODE = 'samma3ni:themeMode';
const STORAGE_ACCENT = 'samma3ni:accent';
const STORAGE_FONT = 'samma3ni:font';

function readStorage(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
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

  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  const theme = useMemo(
    () => buildTheme(resolved, accent, font),
    [resolved, accent, font],
  );

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', accent);
  }, [accent]);

  const value = useMemo(
    () => ({ mode, setMode, accent, setAccent, font, setFont, resolved }),
    [mode, setMode, accent, setAccent, font, setFont, resolved],
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
