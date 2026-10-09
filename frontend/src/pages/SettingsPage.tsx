import {
  Chip,
  Container,
  Divider,
  Paper,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '../components/ui';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../utils/cn';
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

/** MUI's stock `warning.main` (light/dark) — the low-battery status lines. */
const WARNING_TEXT = 'text-[#ed6c02] dark:text-[#ff9800]';

/** Titled card grouping one group of settings. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      {/* MUI's `overline` variant: 12px, uppercase, the tall 2.66 line box. */}
      <span className="ml-1 block text-xs uppercase leading-[2.66] text-muted">
        {title}
      </span>
      <Paper variant="outlined" className="mt-[6px] rounded-[42px] p-4">
        {children}
      </Paper>
    </div>
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
  // The chip used to paint its icon through `sx`; `text.primary` is not a
  // CSS colour, so those two marks always inherited the chip's own text —
  // only a real colour (Telegram's teal) ever took.
  const painted = /^(#|rgb|hsl|var\()/i.test(iconColor);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`${name} — ${children}`}
      className="inline-flex"
    >
      <Chip
        size="small"
        variant="outlined"
        className="font-semibold"
        label={
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-flex text-[17px]"
              style={painted ? { color: iconColor } : undefined}
            >
              {icon}
            </span>
            {children}
          </span>
        }
      />
    </a>
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
    animatedArtwork,
    blurEffects,
    artworkBackground,
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
    <Container maxWidth="sm" className="pb-8 pt-4 md:pt-6">
      <div className="flex flex-col gap-6">
        <div>
          <h5 className="m-0 text-2xl font-bold">Settings</h5>
          <p className="m-0 text-sm leading-[1.43] text-muted">
            Personalize Carmen
          </p>
        </div>

        <Section title="Appearance">
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-2 flex flex-row items-center justify-between">
                <p className="m-0 text-sm leading-[1.43] font-semibold">
                  Color mode
                </p>
                <Chip
                  size="small"
                  label={`Currently ${resolved}`}
                  variant="outlined"
                  className={cn(!whiteOnLight && '!border-accent/50 !text-accent')}
                />
              </div>
              <ToggleButtonGroup
                exclusive
                value={themeMode}
                onChange={(_, value) => {
                  if (value === 'light' || value === 'dark' || value === 'system') {
                    updateSettings({ themeMode: value satisfies ThemeMode });
                  }
                }}
                aria-label="Color mode"
                className="w-full"
              >
                <ToggleButton value="light" className="flex-1">
                  <LightModeIcon fontSize="small" sx={{ mr: 0.75 }} /> Light
                </ToggleButton>
                <ToggleButton value="dark" className="flex-1">
                  <DarkModeIcon fontSize="small" sx={{ mr: 0.75 }} /> Dark
                </ToggleButton>
                <ToggleButton value="system" className="flex-1">
                  <DevicePhoneMobileIcon fontSize="small" sx={{ mr: 0.75 }} /> System
                </ToggleButton>
              </ToggleButtonGroup>
              <span className="mt-[6px] block text-xs leading-[1.4] text-muted">
                System follows your device&apos;s <b>prefers-color-scheme</b> setting live.
              </span>
            </div>

            <Divider />

            <div>
              <div className="mb-2 flex flex-row items-center justify-between">
                <p className="m-0 text-sm leading-[1.43] font-semibold">
                  Interface font
                </p>
                <Chip
                  size="small"
                  label={selectedFont.name}
                  variant="outlined"
                  className={cn(!whiteOnLight && '!border-accent/50 !text-accent')}
                />
              </div>
              <ToggleButtonGroup
                exclusive
                value={font}
                onChange={(_, value) => {
                  if (value === 'alexandria' || value === 'cairo' || value === 'system') {
                    updateSettings({ font: value satisfies FontId });
                  }
                }}
                aria-label="Interface font"
                className="w-full"
              >
                {FONTS.map((option) => (
                  <ToggleButton key={option.id} value={option.id} className="flex-1">
                    {option.name}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <div
                className="mt-[10px] rounded-[28px] bg-hover p-3"
                style={{ fontFamily: fontStack(font) }}
              >
                <p className="m-0 truncate font-bold">
                  Carmen — {selectedFont.name}
                </p>
                <span className="block text-xs leading-[1.4] text-muted">
                  The quick brown fox jumps over the lazy dog
                </span>
                <span
                  dir="rtl"
                  className="mt-[2px] block text-xs leading-[1.4] text-muted"
                >
                  اسمعني — موسيقى بلا حدود
                </span>
              </div>
              <span className="mt-[6px] block text-xs leading-[1.4] text-muted">
                Cairo and Alexandria are loaded from Fontsource and only
                downloaded once you pick them.
              </span>
            </div>

            <Divider />

            <div>
              <div className="mb-2 flex flex-row items-center justify-between">
                <p className="m-0 text-sm leading-[1.43] font-semibold">
                  Accent color
                </p>
                <span className="font-mono text-xs leading-[1.4] text-muted">
                  {accent.toUpperCase()}
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label="Accent color"
                className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-2"
              >
                {ACCENTS.map((option) => {
                  const selected = accent.toLowerCase() === option.color.toLowerCase();
                  return (
                    <Tooltip title={option.name} key={option.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={option.name}
                        onClick={() => updateSettings({ accent: option.color })}
                        className={cn(
                          'grid aspect-square w-full cursor-pointer place-items-center rounded-full p-0',
                          'transition-transform duration-150 hover:scale-[1.08]',
                          selected ? 'border-[3px]' : 'border-2',
                          selected
                            ? 'border-body'
                            : // white on white paper needs an edge to be seen
                              option.color.toLowerCase() === '#ffffff'
                              ? 'border-line'
                              : 'border-transparent',
                          // a white swatch would hide a white checkmark
                          option.color.toLowerCase() === '#ffffff' ? 'text-[#12160f]' : 'text-white',
                        )}
                        style={{ backgroundColor: option.color }}
                      >
                        {selected && <CheckIcon sx={{ fontSize: 18 }} />}
                      </button>
                    </Tooltip>
                  );
                })}
              </div>
              <span className="mt-2 block text-xs leading-[1.4] text-muted">
                Defaults to Material Green ({DEFAULT_ACCENT}).
                {lowBatteryActive && ' Low battery mode overrides it with white while it is on.'}
              </span>
            </div>

            <Divider />

            <div className="flex flex-row items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="m-0 text-sm leading-[1.43] font-semibold">
                  Adaptive accent color
                </p>
                <span className="block text-xs leading-[1.4] text-muted">
                  The accent follows the cover of the song that is playing —
                  the most used color of the artwork, or white when the cover
                  is black. Your chosen accent is used while nothing plays.
                </span>
                {lowBatteryActive && (
                  <span className="block text-xs leading-[1.4] text-muted">
                    Paused while low battery mode is on — your choice is
                    kept and returns when you turn it off.
                  </span>
                )}
              </div>
              <Switch
                checked={adaptiveAccent}
                disabled={lowBatteryActive}
                onChange={(_, checked) => updateSettings({ adaptiveAccent: checked })}
                inputProps={{ 'aria-label': 'Adaptive accent color' }}
                className="shrink-0"
              />
            </div>

            {adaptiveAccent && adaptiveColor && (
              <div className="-mt-[2px] flex flex-row items-center gap-2">
                <div
                  className="h-[14px] w-[14px] shrink-0 rounded-full border border-line"
                  style={{ backgroundColor: adaptiveColor }}
                />
                <span className="font-mono text-xs leading-[1.4] text-muted">
                  {adaptiveColor} — read from the cover of the playing song
                </span>
              </div>
            )}

            <Divider />

            <div className="flex flex-row items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="m-0 text-sm leading-[1.43] font-semibold">
                  Low battery mode
                </p>
                <span className="block text-xs leading-[1.4] text-muted">
                  Saves power by disabling artwork theming, blur and ambient
                  effects — the accent turns white.
                </span>
                {battery.level !== null && (
                  <span
                    className={cn(
                      'block text-xs leading-[1.4]',
                      lowBatteryActive && !lowBatteryManual ? WARNING_TEXT : 'text-muted',
                    )}
                  >
                    {lowBatteryActive && !lowBatteryManual
                      ? `On automatically — battery at ${Math.round(battery.level * 100)}%.`
                      : `Battery at ${Math.round(battery.level * 100)}%${
                          battery.charging ? ', charging' : ''
                        } — turns itself on below 20% while on battery.`}
                  </span>
                )}
              </div>
              <Switch
                checked={lowBatteryManual}
                onChange={(_, checked) => updateSettings({ lowBatteryMode: checked })}
                inputProps={{ 'aria-label': 'Low battery mode' }}
                className="shrink-0"
              />
            </div>

            <Divider />

            <div className="flex flex-row items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="m-0 text-sm leading-[1.43] font-semibold">
                  Animated artwork
                </p>
                <span className="block text-xs leading-[1.4] text-muted">
                  Album covers that move in the Now Playing screen, fetched
                  from Apple's iTunes catalogue — the whole card on
                  desktop, the lyrics page on a phone. Downloads keep a
                  copy for offline playback.
                </span>
                {animatedArtwork && lowBatteryActive && (
                  <span className={cn('block text-xs leading-[1.4]', WARNING_TEXT)}>
                    Off automatically — low battery mode is on.
                  </span>
                )}
              </div>
              <Switch
                checked={animatedArtwork}
                onChange={(_, checked) => updateSettings({ animatedArtwork: checked })}
                inputProps={{ 'aria-label': 'Animated artwork' }}
                className="shrink-0"
              />
            </div>

            <Divider />

            <div className="flex flex-row items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="m-0 text-sm leading-[1.43] font-semibold">
                  Blur effects
                </p>
                <span className="block text-xs leading-[1.4] text-muted">
                  Glass backdrops, accent glows and the ambient wash — off
                  gives flat, lighter surfaces.
                </span>
                {lowBatteryActive && !blurEffects && (
                  <span className="block text-xs leading-[1.4] text-muted">
                    Low battery mode is on as well — both choices are
                    respected when it leaves.
                  </span>
                )}
              </div>
              <Switch
                checked={blurEffects}
                onChange={(_, checked) => updateSettings({ blurEffects: checked })}
                inputProps={{ 'aria-label': 'Blur effects' }}
                className="shrink-0"
              />
            </div>

            <Divider />

            <div className="flex flex-row items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="m-0 text-sm leading-[1.43] font-semibold">
                  Artwork background
                </p>
                <span className="block text-xs leading-[1.4] text-muted">
                  Wash the app background with the colors of the artwork that
                  is playing. Off keeps the plain theme background.
                </span>
                {artworkBackground && lowBatteryActive && (
                  <span className={cn('block text-xs leading-[1.4]', WARNING_TEXT)}>
                    Hidden automatically — low battery mode is on.
                  </span>
                )}
              </div>
              <Switch
                checked={artworkBackground}
                onChange={(_, checked) => updateSettings({ artworkBackground: checked })}
                inputProps={{ 'aria-label': 'Artwork background' }}
                className="shrink-0"
              />
            </div>

            <div className="flex items-center gap-3 rounded-[28px] bg-hover p-3">
              <div
                className={cn(
                  'h-9 w-9 rounded-full bg-accent',
                  // a white accent needs an edge to be seen on this row
                  whiteOnLight && 'border border-line',
                )}
              />
              <div>
                <p
                  className={cn(
                    'm-0 text-sm leading-[1.43] font-semibold',
                    whiteOnLight ? 'text-body' : 'text-accent',
                  )}
                >
                  Primary accent preview
                </p>
                <span className="text-xs leading-[1.4] text-muted">
                  Buttons, active lines and highlights use this color
                </span>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Lyrics">
          <div className="flex flex-col gap-1">
            {LYRICS_PROVIDERS.map((provider) => {
              const selected = lyricsProvider === provider.id;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => updateSettings({ lyricsProvider: provider.id })}
                  aria-pressed={selected}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between gap-3',
                    'rounded-[28px] border-0 px-[10px] py-[6px] text-left text-body hover:bg-hover',
                    selected && 'bg-[rgba(0,0,0,0.08)] dark:bg-[rgba(255,255,255,0.12)]',
                  )}
                >
                  <div className="min-w-0">
                    <p className="m-0 text-sm leading-[1.43] font-semibold">
                      {provider.label}
                    </p>
                    {provider.id === 'auto' && (
                      <span className="block text-xs leading-[1.4] text-muted">
                        YouTube first, then the best public source
                      </span>
                    )}
                  </div>
                  {selected && <CheckIcon color={whiteOnLight ? 'action' : 'primary'} sx={{ fontSize: 18 }} />}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Downloads">
          <div className="flex flex-col gap-[6px]">
            <p className="m-0 text-sm leading-[1.43]">
              Every <b>Download</b> runs entirely in your browser: the audio is fetched from the
              server buffer, converted to MP3 with ffmpeg.wasm and tagged with the title, artists,
              album, year, genre, cover art and the lyrics — synced lyrics are written as LRC
              timestamps — before being saved.
            </p>
            <span className="text-xs leading-[1.4] text-muted">
              Songs longer than 1 hour are not offered by the API.
            </span>
          </div>
        </Section>

        <Section title="Server">
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm leading-[1.43]">
              Optional override of the backend URL — leave the field empty to use the bundled
              default.
            </p>
            <TextField
              fullWidth
              size="small"
              value={apiBase}
              placeholder="http://localhost:8000"
              onChange={(event) => updateSettings({ apiBase: event.target.value })}
              inputProps={{ 'aria-label': 'Backend API base URL' }}
            />
          </div>
        </Section>

        <Section title="Credits">
          <div className="flex flex-col gap-[10px]">
            <div>
              <p className="m-0 text-sm leading-[1.43] font-bold">
                Zaid Ballour
              </p>
              <span className="text-xs leading-[1.4] text-muted">
                Design, development and maintenance of Carmen
              </span>
            </div>
            <div className="flex flex-row flex-wrap gap-2">
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
            </div>
          </div>
        </Section>
      </div>
    </Container>
  );
}
