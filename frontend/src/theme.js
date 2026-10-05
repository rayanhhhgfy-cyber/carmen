import { createTheme } from '@mui/material/styles';

/** Accent palette. Green is the default accent. */
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
];

export const DEFAULT_ACCENT = '#4CAF50';

const SYSTEM_FONT =
  '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Selectable interface fonts.  `stack` is what ends up in
 * `theme.typography.fontFamily`; every entry falls back to the system stack
 * so glyphs that the web font does not cover never break the layout.
 *
 * **Alexandria is the project font** — it ships both the Arabic and the
 * Latin subset, so the whole interface reads the same in either language and
 * it is the first entry (and therefore the fallback for unknown ids).
 */
export const FONTS = [
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

export const DEFAULT_FONT = 'alexandria';

/** Resolve a font id into a CSS font stack (unknown ids fall back to system). */
export function fontStack(fontId) {
  const match = FONTS.find((font) => font.id === fontId);
  return (match || FONTS[0]).stack;
}

/**
 * Build the MUI theme for a resolved color mode and accent color.
 *
 * @param {'light'|'dark'} mode resolved mode (system is already applied)
 * @param {string} accent hex accent color
 * @param {string} [fontId] selected font id (see {@link FONTS})
 */
export function buildTheme(mode, accent, fontId = DEFAULT_FONT) {
  const dark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: { main: accent },
      ...(dark
        ? {
            background: { default: '#0a0d0b', paper: '#121714' },
            text: { primary: '#f1f4f2', secondary: 'rgba(241,244,242,0.62)' },
            divider: 'rgba(255,255,255,0.09)',
          }
        : {
            background: { default: '#f6f7f6', paper: '#ffffff' },
            text: { primary: '#12160f', secondary: 'rgba(18,22,15,0.62)' },
            divider: 'rgba(0,0,0,0.09)',
          }),
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
