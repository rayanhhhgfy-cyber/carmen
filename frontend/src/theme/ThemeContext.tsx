import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { updateSettings, useLowBatteryMode, useSettings } from '../settings/store';
import { cssPalette, fontStack } from '../theme';
import type { FontId, ThemeMode } from '../types/models';

/** What {@link useTheme} answers — one entry per theme engine setting. */
export interface ThemeContextValue {
  /** Chosen mode; `system` follows `prefers-color-scheme` live. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Accent chosen in Settings. */
  accent: string;
  setAccent: (accent: string) => void;
  /**
   * The accent the theme actually wears: the adaptive colour while artwork
   * theming has one, otherwise the chosen accent — and always white while
   * low battery mode is on.
   */
  accentInUse: string;
  /**
   * Accent for things painted **as text / line art** on the app background.
   * Same as {@link accentInUse} except when that colour would disappear:
   * white on a light surface reads as nothing, so light mode falls back to
   * the text colour there (dark mode keeps white — it is perfectly legible).
   * Filled accent surfaces (buttons, FABs, selected chips) pair their
   * `bg-accent` with {@link accentContrast} instead.
   */
  accentFg: string;
  /**
   * Text/icon colour **on top of a filled accent surface** — the
   * `contrastText` MUI used to compute: white when the accent is dark
   * enough (contrast ratio ≥ 3 against white), otherwise 87% black.  Never
   * the accent itself, so a green play button wears a dark icon, not a
   * green-on-green one.
   */
  accentContrast: string;
  /**
   * Whether artwork theming is *actually* running — the stored switch, but
   * forced off while low battery mode is on (the stored choice itself
   * is kept, so leaving the mode restores it).
   */
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
 * Accent low battery mode pins the whole app to: no artwork theming,
 * no hue of its own (see Settings).
 */
const LOW_BATTERY_ACCENT = '#ffffff';

/**
 * Relative luminance of a `#rrggbb` colour (0 = black, 1 = white).
 * Used to decide whether an accent survives on a light surface — white does
 * not, and neither does the pale adaptive colour some covers produce.
 */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return 1;
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/**
 * Theme engine: light / dark / system modes, an accent color (manually
 * picked, or taken from the cover of the song that is playing when
 * "Adaptive accent color" is on) and the interface font.  The choice lives
 * in the settings store (SQLite, hydrated in `main.tsx` before the first
 * render) and the system mode follows `prefers-color-scheme` live.
 *
 * Low battery mode outranks both colour settings: it forces adaptive
 * off and pins the accent to white — manually, or by itself below 20%
 * battery — and because this component is the only place the accent is
 * decided (it feeds the `--app-accent` token and the theme-color meta
 * tag), every consumer follows without knowing the mode exists.
 */
const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const {
    themeMode: mode,
    accent,
    adaptiveAccent: adaptiveSwitch,
    font,
  } = useSettings();
  // Effective mode — the manual toggle or the automatic low-battery kick-in.
  const lowBatteryMode = useLowBatteryMode();
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

  // Low battery mode outranks the adaptive switch — artwork theming
  // counts as off while it is on.  Everything downstream (this provider,
  // the sampler in adaptiveAccent.ts, Settings) reads this effective value,
  // never the stored switch.
  const adaptiveAccent = adaptiveSwitch && !lowBatteryMode;

  // Switching adaptive off goes back to the accent picked in Settings
  // straight away, whoever flipped the switch.
  useEffect(() => {
    if (!adaptiveAccent) setAdaptiveColor(null);
  }, [adaptiveAccent]);

  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  // Adaptive only wins while it is switched on *and* a cover has actually
  // been read; otherwise the accent chosen in Settings is what the app wears.
  // Low battery mode pins that to white, so neither ever shows.
  const accentInUse = lowBatteryMode
    ? LOW_BATTERY_ACCENT
    : adaptiveAccent && adaptiveColor
      ? adaptiveColor
      : accent;

  // A white (or near-white) accent painted as text vanishes on the light
  // surface — fall back to the readable text colour in that one case.
  const accentFg =
    resolved === 'light' && luminance(accentInUse) > 0.85
      ? '#12160f'
      : accentInUse;

  // MUI's `contrastText`: white on the accent while the contrast ratio
  // against white clears 3 (i.e. the accent is dark enough), otherwise
  // 87% black — the ratio math matches `getContrastRatio` from
  // @mui/material so every filled surface keeps its old legibility.
  const accentContrast =
    1.05 / (luminance(accentInUse) + 0.05) >= 3 ? '#ffffff' : 'rgba(0,0,0,0.87)';

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', accentInUse);
  }, [accentInUse]);

  /**
   * Publish the live theme onto `<html>`: `data-theme` drives the `dark:`
   * variant, the `--app-*` properties feed the `@theme` tokens in
   * `styles.css` — the single engine since MUI left, so every surface wears
   * the same colours the palette in `theme.ts` declares.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    const tokens: Record<string, string> = {
      ...cssPalette(resolved),
      '--app-accent': accentInUse,
      '--app-accent-fg': accentFg,
      '--app-accent-contrast': accentContrast,
      '--app-font': fontStack(font),
    };
    for (const [name, value] of Object.entries(tokens)) {
      root.style.setProperty(name, value);
    }
  }, [resolved, accentInUse, accentFg, accentContrast, font]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      accent,
      setAccent,
      accentInUse,
      accentFg,
      accentContrast,
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
      accentFg,
      accentContrast,
      adaptiveAccent,
      setAdaptiveAccent,
      adaptiveColor,
      setAdaptiveColor,
      font,
      setFont,
      resolved,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
