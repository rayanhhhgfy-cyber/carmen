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
