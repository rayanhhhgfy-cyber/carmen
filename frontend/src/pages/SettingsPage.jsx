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
import CheckIcon from '@mui/icons-material/Check';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SmartphoneIcon from '@mui/icons-material/SettingsBrightness';

import { ACCENTS, DEFAULT_ACCENT } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { API_BASE } from '../api';

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

/** Theme engine controls: color mode + accent color. */
export default function SettingsPage() {
  const { mode, setMode, accent, setAccent, resolved } = useTheme();

  return (
    <Container maxWidth="sm" sx={{ pt: { xs: 2, md: 3 }, pb: 4 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h5">Settings</Typography>
          <Typography variant="body2" color="text.secondary">
            Personalize Samma3ni
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
                  <SmartphoneIcon fontSize="small" sx={{ mr: 0.75 }} /> System
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
              album, year, genre, cover art and synced lyrics before being saved.
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Songs longer than 1 hour are not offered by the API.
            </Typography>
          </Stack>
        </Section>

        <Section title="Backend">
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {API_BASE}
            </Typography>
            <Chip size="small" label="FastAPI + yt-dlp" variant="outlined" />
          </Stack>
        </Section>
      </Stack>
    </Container>
  );
}
