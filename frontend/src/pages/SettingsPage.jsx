import {
  Box,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { ACCENTS, DEFAULT_ACCENT, FONTS, fontStack } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import {
  CheckIcon,
  DarkModeIcon,
  DevicePhoneMobileIcon,
  GitHubIcon,
  LightModeIcon,
  TelegramIcon,
  XIcon,
} from '../components/icons';

function Section({ title, children }) {
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

/**
 * Credit link: the platform's own mark with the handle beside it, opening
 * in a new tab.  `name` is what a screen reader hears — the visible label
 * is only the handle, the icon carries the rest.
 */
function Credit({ href, name, icon, iconColor, children }) {
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

/** Theme engine controls: color mode + accent color + interface font. */
export default function SettingsPage() {
  const { mode, setMode, accent, setAccent, font, setFont, resolved } = useTheme();
  const selectedFont = FONTS.find((option) => option.id === font) || FONTS[0];

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
                  color="primary"
                  variant="outlined"
                />
              </Stack>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={mode}
                onChange={(_, value) => value && setMode(value)}
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
                <Chip size="small" label={selectedFont.name} color="primary" variant="outlined" />
              </Stack>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={font}
                onChange={(_, value) => value && setFont(value)}
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
                        onClick={() => setAccent(option.color)}
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
              </Typography>
            </Box>

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
              <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: 'primary.main' }} />
              <Box>
                <Typography variant="body2" fontWeight={600} color="primary.main">
                  Primary accent preview
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Buttons, active lines and highlights use this color
                </Typography>
              </Box>
            </Box>
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
