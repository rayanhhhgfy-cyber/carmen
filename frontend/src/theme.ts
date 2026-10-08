import { createTheme } from '@mui/material/styles';

import type { FontId } from './types/models';

/** One selectable accent of the palette. */
export interface AccentOption {
  id: string;
  name: string;
  color: string;
}

/** Accent palette. Green is the default accent. */
export const ACCENTS: AccentOption[] = [
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
  { id: 'white', name: 'White', color: '#ffffff' },
];

export const DEFAULT_ACCENT = '#4CAF50';

const SYSTEM_FONT =
  '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** One selectable interface font. */
export interface FontOption {
  id: FontId;
  name: string;
  stack: string;
}

/**
 * Selectable interface fonts.  `stack` is what ends up in
 * `theme.typography.fontFamily`; every entry falls back to the system stack
 * so glyphs that the web font does not cover never break the layout.
 *
 * **Alexandria is the project font** — it ships both the Arabic and the
 * Latin subset, so the whole interface reads the same in either language and
 * it is the first entry (and therefore the fallback for unknown ids).
 */
export const FONTS: FontOption[] = [
  {
    id: 'alexandria',
    name: 'Alexandria',
    stack: `"Alexandria", ${SYSTEM_FONT}`,
  },
  {
    id: 'cairo',
    name: 'Cairo',
    stack: `"Cairo", ${SYSTEM_FONT}`,
  },
  { id: 'system', name: 'System default', stack: SYSTEM_FONT },
];

export const DEFAULT_FONT: FontId = 'alexandria';

/**
 * The two surface palettes — **single source of truth** for both theme
 * engines: MUI wears it through `buildTheme`, Tailwind through the `--app-*`
 * custom properties `ThemeProvider` publishes on `<html>` (see
 * `styles.css`).  Editing a colour here restyles the whole migration.
 */
const PALETTE = {
  dark: {
    bg: '#0a0d0b',
    paper: '#121714',
    text: '#f1f4f2',
    textSecondary: 'rgba(241,244,242,0.62)',
    divider: 'rgba(255,255,255,0.09)',
  },
  light: {
    bg: '#f6f7f6',
    paper: '#ffffff',
    text: '#12160f',
    textSecondary: 'rgba(18,22,15,0.62)',
    divider: 'rgba(0,0,0,0.09)',
  },
} as const;

/**
 * The palette of a resolved mode as CSS custom properties — the Tailwind
 * twin of `buildTheme`'s `palette` block, applied on `documentElement`.
 */
export function cssPalette(mode: 'light' | 'dark'): Record<string, string> {
  const colors = PALETTE[mode];
  return {
    '--app-bg': colors.bg,
    '--app-paper': colors.paper,
    '--app-text': colors.text,
    '--app-text-secondary': colors.textSecondary,
    '--app-divider': colors.divider,
    // MUI default theme values the Tailwind tokens mirror: disabled text is
    // identical to action.disabled, action.active and success come from the
    // stock light/dark palettes, hover is the stock action.hover.
    '--app-text-disabled': mode === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.26)',
    '--app-action-active': mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.54)',
    '--app-success': mode === 'dark' ? '#4caf50' : '#2e7d32',
    '--app-hover': mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
  };
}

/** Resolve a font id into a CSS font stack (unknown ids fall back to system). */
export function fontStack(fontId: FontId): string {
  const match = FONTS.find((font) => font.id === fontId);
  return (match || FONTS[0]).stack;
}

/**
 * Build the MUI theme for a resolved color mode and accent color.
 *
 * @param mode resolved mode (system is already applied)
 * @param accent hex accent color
 * @param fontId selected font id (see {@link FONTS})
 */
export function buildTheme(mode: 'light' | 'dark', accent: string, fontId: FontId = DEFAULT_FONT) {
  const colors = PALETTE[mode];

  return createTheme({
    palette: {
      mode,
      primary: { main: accent },
      background: { default: colors.bg, paper: colors.paper },
      text: { primary: colors.text, secondary: colors.textSecondary },
      divider: colors.divider,
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: fontStack(fontId),
      h5: { fontWeight: 700, letterSpacing: '-0.02em' },
      h6: { fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 600 },
      button: { fontWeight: 600, textTransform: 'none' },
    },
    components: {
      /*
       * A `<button>` does **not** inherit `font-family` or `color` from its
       * parent — the browser stylesheet paints them with its own defaults.
       * Every card, list row and tab in this app is a real button, so without
       * this override the font picked in Settings never showed up on them and
       * song titles stayed black in dark mode.  Both rules keep a very low
       * specificity, so component level colours still win.
       */
      MuiCssBaseline: {
        styleOverrides: {
          'button, input, select, textarea': {
            fontFamily: 'inherit',
            color: 'inherit',
          },
          /*
           * Scrollbars are hidden everywhere — home, lyrics, queue,
           * settings, the player, the whole window.  Scrolling itself is
           * untouched: wheel, trackpad, touch, keyboard and the drag of a
           * hidden track all still work, only the bar is no longer painted.
           *
           * `scrollbar-width` is the modern (Firefox) way, `msOverflowStyle`
           * covers legacy Edge, and the webkit pseudo element hides the bar
           * in Chrome, Edge and Safari — including the document scrollbar,
           * which Blink draws from the root element's pseudo element.
           */
          '*': {
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          },
          '::-webkit-scrollbar, *::-webkit-scrollbar': {
            width: 0,
            height: 0,
            display: 'none',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 999, paddingInline: 18 },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { borderRadius: 16, overflow: 'hidden' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 999, fontWeight: 600 },
        },
      },
      MuiListItemButton: {
        styleOverrides: { root: { borderRadius: 12 } },
      },
      MuiBottomNavigationAction: {
        styleOverrides: {
          root: { minWidth: 64, color: 'inherit' },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 18 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { borderRadius: 8, fontSize: 12 },
        },
      },
    },
  });
}
