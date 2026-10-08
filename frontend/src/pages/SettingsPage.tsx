import {
  Box,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { ReactElement, ReactNode } from 'react';
import { ACCENTS, DEFAULT_ACCENT, FONTS, fontStack } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { useBattery } from '../settings/battery';
import { updateSettings, useLowBatteryMode, useSettings } from '../settings/store';
import { LYRICS_PROVIDERS } from '../types/models';
import type { FontId, ThemeMode } from '../types/models';
import {
  CheckIcon,
  DarkModeIcon,
  DevicePhoneMobileIcon,
  GitHubIcon,
  LightModeIcon,
  TelegramIcon,
  XIcon,
} from '../components/icons';

/** Titled card grouping one group of settings. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ ml: 0.5 }}>
        {title}
      </Typography>
      <Paper variant="outlined" sx={{ mt: 0.75, borderRadius: 3, p: 2 }}>
        {children}
      </Paper>
    </Box>
  );
}

/** Props for the credit link chip. */
interface CreditProps {
  href: string;
  name: string;
  icon: ReactElement;
  iconColor: string;
  children: ReactNode;
}

/**
 * Credit link: the platform's own mark with the handle beside it, opening
 * in a new tab.  `name` is what a screen reader hears — the visible label
 * is only the handle, the icon carries the rest.
 */
function Credit({ href, name, icon, iconColor, children }: CreditProps) {
  return (
    <Chip
      component="a"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      clickable
      size="small"
      variant="outlined"
      icon={icon}
      label={children}
      aria-label={`${name} — ${children}`}
      sx={{
        fontWeight: 600,
        '& .MuiChip-icon': { fontSize: 17, color: iconColor },
      }}
    />
  );
}

/**
 * Theme engine controls: color mode + accent color + interface font.
 *
 * Every persisted choice is written straight through the settings store;
 * the theme context lends its session state (the resolved mode, the color
 * read from the playing cover) and the effective accent / adaptive values,
 * which low battery mode overrides.
 */
export default function SettingsPage() {
  const {
    themeMode,
    accent,
    font,
    lyricsProvider,
    apiBase,
    lowBatteryMode: lowBatteryManual,
  } = useSettings();
  // The *effective* mode (manual toggle or the automatic low-battery
  // kick-in) and the reading behind its status line.
  const lowBatteryActive = useLowBatteryMode();
  const battery = useBattery();
  // `adaptiveAccent` and `accentInUse` come from the theme context: they are
  // the *effective* values, so low battery mode shows through here.
  const { adaptiveColor, resolved, accentInUse, adaptiveAccent } = useTheme();
  const selectedFont = FONTS.find((option) => option.id === font) || FONTS[0];

  // A white accent on the light theme would paint primary labels, borders
  // and icons white on white — low battery mode pins the accent to
  // white (and a black cover can make adaptive pick it too), so those few
  // spots fall back to plain colours while it reads that way. The dark
  // theme reads white perfectly and keeps them.
  const whiteOnLight = resolved === 'light' && accentInUse.toLowerCase() === '#ffffff';

  return (
    <Container maxWidth="sm" sx={{ pt: { xs: 2, md: 3 }, pb: 4 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5">Settings</Typography>
          <Typography variant="body2" color="text.secondary">
            Personalize Carmen
          </Typography>
        </Box>

        <Section title="Appearance">
          <Stack spacing={2}>
            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="body2" fontWeight={600}>
                  Color mode
                </Typography>
                <Chip
                  size="small"
                  label={`Currently ${resolved}`}
                  color={whiteOnLight ? 'default' : 'primary'}
                  variant="outlined"
                />
              </Stack>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={themeMode}
                onChange={(_, value) => {
                  if (value === 'light' || value === 'dark' || value === 'system') {
                    updateSettings({ themeMode: value satisfies ThemeMode });
                  }
                }}
                aria-label="Color mode"
              >
                <ToggleButton value="light">
                  <LightModeIcon fontSize="small" sx={{ mr: 0.75 }} /> Light
                </ToggleButton>
                <ToggleButton value="dark">
                  <DarkModeIcon fontSize="small" sx={{ mr: 0.75 }} /> Dark
                </ToggleButton>
                <ToggleButton value="system">
                  <DevicePhoneMobileIcon fontSize="small" sx={{ mr: 0.75 }} /> System
                </ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                System follows your device&apos;s <b>prefers-color-scheme</b> setting live.
              </Typography>
            </Box>

            <Divider />

            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="body2" fontWeight={600}>
                  Interface font
                </Typography>
                <Chip
                  size="small"
                  label={selectedFont.name}
                  color={whiteOnLight ? 'default' : 'primary'}
                  variant="outlined"
                />
              </Stack>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={font}
                onChange={(_, value) => {
                  if (value === 'alexandria' || value === 'cairo' || value === 'system') {
                    updateSettings({ font: value satisfies FontId });
                  }
                }}
                aria-label="Interface font"
              >
                {FONTS.map((option) => (
                  <ToggleButton key={option.id} value={option.id}>
                    {option.name}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Box
                sx={{
                  mt: 1.25,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: 'action.hover',
                  fontFamily: fontStack(font),
                }}
              >
                <Typography sx={{ fontFamily: 'inherit', fontWeight: 700 }} noWrap>
                  Carmen — {selectedFont.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: 'inherit', display: 'block' }}
                >
                  The quick brown fox jumps over the lazy dog
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  dir="rtl"
                  sx={{ fontFamily: 'inherit', display: 'block', mt: 0.25 }}
                >
                  اسمعني — موسيقى بلا حدود
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                Cairo and Alexandria are loaded from Fontsource and only
                downloaded once you pick them.
              </Typography>
            </Box>

            <Divider />

            <Box>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="body2" fontWeight={600}>
                  Accent color
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                  {accent.toUpperCase()}
                </Typography>
              </Stack>
              <Box
                role="radiogroup"
                aria-label="Accent color"
                sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 1 }}
              >
                {ACCENTS.map((option) => {
                  const selected = accent.toLowerCase() === option.color.toLowerCase();
                  return (
                    <Tooltip title={option.name} key={option.id}>
                      <Box
                        component="button"
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={option.name}
                        onClick={() => updateSettings({ accent: option.color })}
                        sx={{
                          width: '100%',
                          aspectRatio: '1 / 1',
                          borderRadius: '50%',
                          border: selected ? '3px solid' : '2px solid transparent',
                          borderColor: selected ? 'text.primary' : 'transparent',
                          bgcolor: option.color,
                          cursor: 'pointer',
                          display: 'grid',
                          placeItems: 'center',
                          color: '#fff',
                          p: 0,
                          transition: 'transform 150ms ease',
                          '&:hover': { transform: 'scale(1.08)' },
                        }}
                      >
                        {selected && <CheckIcon sx={{ fontSize: 18 }} />}
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Defaults to Material Green ({DEFAULT_ACCENT}).
                {lowBatteryActive && ' Low battery mode overrides it with white while it is on.'}
              </Typography>
            </Box>

            <Divider />

            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>
                  Adaptive accent color
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  The accent follows the cover of the song that is playing —
                  the most used color of the artwork, or white when the cover
                  is black. Your chosen accent is used while nothing plays.
                </Typography>
                {lowBatteryActive && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Paused while low battery mode is on — your choice is
                    kept and returns when you turn it off.
                  </Typography>
                )}
              </Box>
              <Switch
                checked={adaptiveAccent}
                disabled={lowBatteryActive}
                onChange={(_, checked) => updateSettings({ adaptiveAccent: checked })}
                inputProps={{ 'aria-label': 'Adaptive accent color' }}
                sx={{ flexShrink: 0 }}
              />
            </Stack>

            {adaptiveAccent && adaptiveColor && (
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: -0.5 }}>
                <Box
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    bgcolor: adaptiveColor,
                    border: 1,
                    borderColor: 'divider',
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                  {adaptiveColor} — read from the cover of the playing song
                </Typography>
              </Stack>
            )}

            <Divider />

            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>
                  Low battery mode
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Saves power by disabling artwork theming, blur and ambient
                  effects — the accent turns white.
                </Typography>
                {battery.level !== null && (
                  <Typography
                    variant="caption"
                    color={lowBatteryActive && !lowBatteryManual ? 'warning.main' : 'text.secondary'}
                    sx={{ display: 'block' }}
                  >
                    {lowBatteryActive && !lowBatteryManual
                      ? `On automatically — battery at ${Math.round(battery.level * 100)}%.`
                      : `Battery at ${Math.round(battery.level * 100)}%${
                          battery.charging ? ', charging' : ''
                        } — turns itself on below 20% while on battery.`}
                  </Typography>
                )}
              </Box>
              <Switch
                checked={lowBatteryManual}
                onChange={(_, checked) => updateSettings({ lowBatteryMode: checked })}
                inputProps={{ 'aria-label': 'Low battery mode' }}
                sx={{ flexShrink: 0 }}
              />
            </Stack>

            <Box
              sx={{
                p: 1.5,
                borderRadius: 2,
                bgcolor: 'action.hover',
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
              }}
            >
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  // a white accent needs an edge to be seen on this row
                  border: whiteOnLight ? 1 : 0,
                  borderColor: 'divider',
                }}
              />
              <Box>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  color={whiteOnLight ? 'text.primary' : 'primary.main'}
                >
                  Primary accent preview
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Buttons, active lines and highlights use this color
                </Typography>
              </Box>
            </Box>
          </Stack>
        </Section>

        <Section title="Lyrics">
          <Stack spacing={0.5}>
            {LYRICS_PROVIDERS.map((provider) => {
              const selected = lyricsProvider === provider.id;
              return (
                <Box
                  key={provider.id}
                  component="button"
                  type="button"
                  onClick={() => updateSettings({ lyricsProvider: provider.id })}
                  aria-pressed={selected}
                  sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1.5,
                    px: 1.25,
                    py: 0.75,
                    border: 0,
                    borderRadius: 2,
                    bgcolor: selected ? 'action.selected' : 'transparent',
                    color: 'text.primary',
                    textAlign: 'left',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {provider.label}
                    </Typography>
                    {provider.id === 'auto' && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        YouTube first, then the best public source
                      </Typography>
                    )}
                  </Box>
                  {selected && <CheckIcon color={whiteOnLight ? 'action' : 'primary'} sx={{ fontSize: 18 }} />}
                </Box>
              );
            })}
          </Stack>
        </Section>

        <Section title="Downloads">
          <Stack spacing={0.75}>
            <Typography variant="body2">
              Every <b>Download</b> runs entirely in your browser: the audio is fetched from the
              server buffer, converted to MP3 with ffmpeg.wasm and tagged with the title, artists,
              album, year, genre, cover art and the lyrics — synced lyrics are written as LRC
              timestamps — before being saved.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Songs longer than 1 hour are not offered by the API.
            </Typography>
          </Stack>
        </Section>

        <Section title="Server">
          <Stack spacing={1}>
            <Typography variant="body2">
              Optional override of the backend URL — leave the field empty to use the bundled
              default.
            </Typography>
            <TextField
              fullWidth
              size="small"
              value={apiBase}
              placeholder="http://localhost:8000"
              onChange={(event) => updateSettings({ apiBase: event.target.value })}
              slotProps={{
                input: { 'aria-label': 'Backend API base URL' },
              }}
            />
          </Stack>
        </Section>

        <Section title="Credits">
          <Stack spacing={1.25}>
            <Box>
              <Typography variant="body2" fontWeight={700}>
                Zaid Ballour
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Design, development and maintenance of Carmen
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Credit
                href="https://github.com/z44d"
                name="GitHub"
                icon={<GitHubIcon />}
                iconColor="text.primary"
              >
                @z44d
              </Credit>
              <Credit
                href="https://x.com/0z44d"
                name="X"
                icon={<XIcon />}
                iconColor="text.primary"
              >
                @0z44d
              </Credit>
              <Credit
                href="https://t.me/zaidballour"
                name="Telegram"
                icon={<TelegramIcon />}
                iconColor="#229ED9"
              >
                @zaidballour
              </Credit>
            </Stack>
          </Stack>
        </Section>
      </Stack>
    </Container>
  );
}
