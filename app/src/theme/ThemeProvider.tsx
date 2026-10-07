import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useSettingsStore } from '../state/settingsStore';

import { buildTheme, type Theme, type ThemeMode } from './tokens';

/**
 * Theme engine: light / dark / system modes, an accent color (manually
 * picked, or taken from the cover of the song that is playing when
 * "Adaptive accent color" is on) and the interface font — the RN port of
 * `frontend/src/theme/ThemeContext.jsx`.
 *
 * The persistent parts (mode / accent / adaptive / font) live in the zustand
 * `settingsStore` behind a swappable `SettingsPersistence`; only the session
 * state — `adaptiveColor`, re-derived from the artwork every time a track
 * starts — is held here.  The provider renders `null` until the persisted
 * settings have been hydrated (App shows a splash until then).
 */
export interface ThemeContextValue {
  mode: ThemeMode;
  setMode(mode: ThemeMode): void;
  accent: string;
  setAccent(color: string): void;
  /** The colour the theme actually wears: adaptive while it applies. */
  accentInUse: string;
  adaptiveAccent: boolean;
  setAdaptiveAccent(enabled: boolean): void;
  adaptiveColor: string | null;
  setAdaptiveColor(color: string | null): void;
  font: string;
  setFont(font: string): void;
  resolved: 'light' | 'dark';
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useSettingsStore((state) => state.hydrated);
  const mode = useSettingsStore((state) => state.mode);
  const accent = useSettingsStore((state) => state.accent);
  const font = useSettingsStore((state) => state.font);
  const adaptiveAccent = useSettingsStore((state) => state.adaptiveAccent);
  const resolved = useSettingsStore((state) => state.resolved);
  const setMode = useSettingsStore((state) => state.setMode);
  const setAccent = useSettingsStore((state) => state.setAccent);
  const setFont = useSettingsStore((state) => state.setFont);
  const setAdaptiveAccentState = useSettingsStore((state) => state.setAdaptiveAccent);

  // Colour read out of the playing song's cover — session state, because it
  // is re-derived from the artwork every time a track starts (see
  // theme/adaptiveAccent.ts).
  const [adaptiveColor, setAdaptiveColor] = useState<string | null>(null);

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
  }, []);

  // Adaptive only wins while it is switched on *and* a cover has actually
  // been read; otherwise the accent chosen in Settings is what the app wears.
  const accentInUse = adaptiveAccent && adaptiveColor ? adaptiveColor : accent;

  const theme = useMemo(
    () => buildTheme(resolved, accentInUse, font),
    [resolved, accentInUse, font],
  );

  const setAdaptiveAccent = useCallback(
    (enabled: boolean) => {
      setAdaptiveAccentState(enabled);
      // switching it off goes back to the accent picked above straight away
      if (!enabled) setAdaptiveColor(null);
    },
    [setAdaptiveAccentState],
  );

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
      theme,
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
      font,
      setFont,
      resolved,
      theme,
    ],
  );

  // Nothing renders until the persisted settings have been read — App shows
  // its splash View while we are null (Task 18 wires that up).
  if (!hydrated) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
