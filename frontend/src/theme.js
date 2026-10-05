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

const FONT =
  '"Inter", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Build the MUI theme for a resolved color mode and accent color.
 *
 * @param {'light'|'dark'} mode resolved mode (system is already applied)
 * @param {string} accent hex accent color
 */
export function buildTheme(mode, accent) {
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
      fontFamily: FONT,
      h5: { fontWeight: 700, letterSpacing: '-0.02em' },
      h6: { fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 600 },
      button: { fontWeight: 600, textTransform: 'none' },
    },
    components: {
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
