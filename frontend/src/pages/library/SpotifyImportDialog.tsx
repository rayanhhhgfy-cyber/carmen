/**
 * Universal import dialog (generalised from the Spotify-only original).
 *
 * A four-act flow that never leaves this dialog:
 *
 *   1. **input** — paste any supported link (validated locally with
 *      `detectImportLink`): a Spotify playlist / album / track / artist,
 *      an Apple Music album, a YouTube / YouTube Music video or playlist,
 *      or a Carmen share link / code;
 *   2. **preview** — the source's cover, owner and track list, straight
 *      from the source, so the user knows exactly what is about to
 *      convert. Carmen shares skip conversion entirely: the preview is
 *      the shared playlist itself and the primary action imports it
 *      directly;
 *   3. **converting** — the backend streams one event per track; the
 *      progress bar, percentage and live counters render those real
 *      numbers — nothing is faked;
 *   4. **results** — every track with its match status, confidence and
 *      the YouTube Music song it resolved to; the user picks the winners
 *      and saves them as a normal library playlist (playable,
 *      downloadable, offline-capable like any other).
 *
 * The dialog is a centred sheet on desktop and stretches to nearly the
 * full viewport on a phone; every row wraps instead of overflowing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

import { Button, Chip, IconButton, Spinner } from '../../components/ui';
import { Dialog, DialogActions, DialogContent, DialogTitle } from '../../components/ui/Overlay';
import { TextField } from '../../components/ui/Field';
import MarqueeText from '../../components/MarqueeText';
import { cn } from '../../utils/cn';
import {
  convertImportSource,
  detectImportLink,
  friendlyConvertError,
  resolveImportSource,
  saveConversionAsPlaylist,
  type ImportKind,
  type TrackConversion,
} from '../../services/spotifyConvert';
import { importSharedPlaylist, resolveSharedPlaylist } from '../../services/playlistShare';
import { Artwork, CheckCircleIcon, CloseIcon, MusicNoteIcon } from './glyphs';

export const SPOTIFY_GREEN = '#1DB954';

/** CSS accent token the theme publishes (non-Spotify sources wear it). */
const APP_ACCENT = 'var(--app-accent)';

type Step = 'input' | 'preview' | 'converting' | 'results' | 'saved';

interface SpotifyImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Jump to the newly created playlist (the parent owns the detail view). */
  onOpenPlaylist: (playlistId: number) => void;
  /**
   * Optional link/code the dialog opens with: the input is prefilled and
   * the flow auto-advances to the preview step (the Search page's
   * "link detected" banner passes the pasted text here).
   */
  initialUrl?: string;
}

/* ── source kinds ─────────────────────────────────────────────────────── */

/** Human label of every source kind the import flow understands. */
export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  'spotify-playlist': 'Spotify playlist',
  'spotify-album': 'Spotify album',
  'spotify-track': 'Spotify track',
  'spotify-artist': 'Spotify artist',
  'apple-album': 'Apple Music album',
  'apple-playlist': 'Apple Music playlist',
  'youtube-video': 'YouTube video',
  'youtube-playlist': 'YouTube playlist',
  'carmen-share': 'Carmen shared playlist',
};

/** Label for a kind value (also tolerates the raw `source` field of a row). */
export function importKindLabel(kind: unknown): string {
  if (typeof kind === 'string' && kind in IMPORT_KIND_LABELS) {
    return IMPORT_KIND_LABELS[kind as ImportKind];
  }
  return 'Imported source';
}

function isSpotifyKind(kind: ImportKind | null | undefined): boolean {
  return Boolean(kind && kind.startsWith('spotify'));
}

/* ── unified preview state ────────────────────────────────────────────── */

interface PreviewTrack {
  id: string;
  title: string;
  artist: string;
}

interface PreviewState {
  kind: ImportKind;
  name: string;
  owner: string;
  artwork: string | null;
  trackCount: number;
  description?: string;
  tracks: PreviewTrack[];
}

/** Reads one track-like value (source track or shared-playlist track). */
function previewTrack(track: unknown, index: number): PreviewTrack {
  const record = (track ?? {}) as Record<string, unknown>;
  const artist =
    typeof record.artist === 'string'
      ? record.artist
      : Array.isArray(record.artists)
        ? record.artists
            .map((entry: unknown) =>
              typeof entry === 'string' ? entry : (entry as { name?: string })?.name,
            )
            .filter(Boolean)
            .join(', ')
        : '';
  const id =
    typeof record.id === 'string' && record.id
      ? record.id
      : typeof record.videoId === 'string' && record.videoId
        ? record.videoId
        : `track-${index}`;
  return {
    id,
    title: typeof record.title === 'string' && record.title ? record.title : 'Untitled',
    artist: artist ?? '',
  };
}

interface ConvertProgressState {
  done: number;
  total: number;
  result: TrackConversion;
}

/* ── Spotify mark ─────────────────────────────────────────────────────── */

/** The Spotify-ish mark used by the import entry points (also the section). */
export function SpotifyMark({ size = 22, sx }: { size?: number; sx?: { fontSize?: number } }) {
  const rendered = sx?.fontSize ?? size;
  return (
    <svg width={rendered} height={rendered} viewBox="0 0 24 24" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="12" fill={SPOTIFY_GREEN} />
      <g fill="none" stroke="#0b0b0b" strokeLinecap="round">
        <path d="M7.2 10.4c3.1-1 7.9-.9 10.9 1" strokeWidth="1.7" />
        <path d="M7.9 13.1c2.6-.8 6.4-.7 8.9.9" strokeWidth="1.5" />
        <path d="M8.6 15.6c2.1-.6 5-.5 6.9.7" strokeWidth="1.3" />
      </g>
    </svg>
  );
}

/** Generic source mark for non-Spotify kinds (app accent, library glyph). */
function SourceMark({ size = 22, kind }: { size?: number; kind?: ImportKind | null }) {
  if (isSpotifyKind(kind)) return <SpotifyMark size={size} />;
  return <MusicNoteIcon style={{ fontSize: size, color: APP_ACCENT }} />;
}

/* ── match status furniture ───────────────────────────────────────────── */

const STATUS_META = {
  matched: { label: 'Matched', color: '#1DB954', bg: 'rgba(29,185,84,0.14)' },
  approximate: { label: 'Close match', color: '#e8a13c', bg: 'rgba(232,161,60,0.14)' },
  not_found: { label: 'No match', color: '#9aa0a6', bg: 'rgba(154,160,166,0.14)' },
  error: { label: 'Failed', color: '#e5484d', bg: 'rgba(229,72,77,0.14)' },
} as const;

function StatusPill({ status, confidence }: { status: keyof typeof STATUS_META; confidence: number }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold leading-5"
      style={{ color: meta.color, background: meta.bg }}
    >
      {status === 'matched' && <CheckCircleIcon style={{ fontSize: 13 }} />}
      {status === 'not_found' && <CloseIcon style={{ fontSize: 13 }} />}
      {meta.label}
      {(status === 'matched' || status === 'approximate') && (
        <span className="opacity-80">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

/* ── accessible checkbox (the kit has no Checkbox) ────────────────────── */

function RowCheckbox({
  checked,
  onChange,
  label,
  spotify = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  /** Checked fill: Spotify green for Spotify sources, app accent otherwise. */
  spotify?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border-2 transition-colors',
        checked ? 'border-transparent' : 'border-line bg-transparent hover:border-muted',
        checked && !spotify && 'bg-accent text-accent-contrast',
      )}
      style={checked && spotify ? { background: SPOTIFY_GREEN } : undefined}
    >
      {checked && (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path
            d="M2.5 7.2 5.6 10.3 11.5 3.9"
            fill="none"
            stroke={spotify ? '#0b0b0b' : 'currentColor'}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

/* ── determinate progress bar ─────────────────────────────────────────── */

function Meter({ value, spotify = false }: { value: number; spotify?: boolean }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="h-2 w-full overflow-hidden rounded-full bg-hover"
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-300 ease-out', !spotify && 'bg-accent')}
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          ...(spotify ? { background: SPOTIFY_GREEN } : null),
        }}
      />
    </div>
  );
}

/* ══ the dialog ══════════════════════════════════════════════════════════ */

export default function SpotifyImportDialog({
  open,
  onClose,
  onOpenPlaylist,
  initialUrl,
}: SpotifyImportDialogProps) {
  const [step, setStep] = useState<Step>('input');
  const [link, setLink] = useState('');
  const [linkTouched, setLinkTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [progress, setProgress] = useState<ConvertProgressState | null>(null);
  const [live, setLive] = useState<TrackConversion[]>([]);
  const [results, setResults] = useState<TrackConversion[]>([]);
  const [summary, setSummary] = useState({ total: 0, matched: 0, approximate: 0, not_found: 0, error: 0 });
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [sharedImport, setSharedImport] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const detected = useMemo(() => detectImportLink(link.trim()), [link]);
  const linkValid = detected !== null;
  const showLinkError = linkTouched && link.trim() !== '' && !linkValid;

  /** Kind in play: the resolved preview wins, then whatever is typed. */
  const activeKind: ImportKind | null = preview?.kind ?? detected?.kind ?? null;
  const spotify = isSpotifyKind(activeKind);
  const isShare = activeKind === 'carmen-share';
  const sourceLabel = importKindLabel(activeKind);
  const accentColor = spotify ? SPOTIFY_GREEN : APP_ACCENT;
  /** Primary-action classes: Spotify sources keep the brand treatment. */
  const primaryClass = spotify
    ? '!bg-[#1DB954] !text-black hover:!bg-[#1ed760] disabled:!bg-hover disabled:!text-disabled'
    : 'disabled:!bg-hover disabled:!text-disabled';

  /* ── act 1 → 2: resolve the pasted link ── */

  const fetchPreviewFor = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    setLinkTouched(true);
    const detection = detectImportLink(trimmed);
    if (!detection) return;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (detection.kind === 'carmen-share') {
        // Carmen shares bypass conversion: the preview IS the shared
        // playlist, and the primary action imports it directly.
        const shared = await resolveSharedPlaylist(trimmed);
        setPreview({
          kind: 'carmen-share',
          name: shared.name,
          owner: '',
          artwork: shared.artwork ?? null,
          trackCount: shared.tracks.length,
          description: shared.description ?? undefined,
          tracks: shared.tracks.map((track, index) => previewTrack(track, index)),
        });
        setName(shared.name);
      } else {
        const info = await resolveImportSource(trimmed);
        const sourceRecord = info.source as unknown as Record<string, unknown>;
        setPreview({
          kind: info.source.kind,
          name: info.source.name,
          owner: info.source.owner ?? '',
          artwork: info.source.artwork ?? null,
          trackCount: info.source.trackCount ?? info.tracks.length,
          description:
            typeof sourceRecord.description === 'string' ? sourceRecord.description : undefined,
          tracks: info.tracks.map((track, index) => previewTrack(track, index)),
        });
        setName(info.source.name);
      }
      setStep('preview');
    } catch (fetchError) {
      if ((fetchError as Error)?.name === 'AbortError') return;
      // A failed resolve must never leave a stale preview behind: clear
      // it so no convertible state can be presented after a failure —
      // the dialog stays on the input step with the error banner.
      setPreview(null);
      // Includes the Apple Music playlist case: the server answers with a
      // precise unsupported-source message, surfaced readably as-is.
      setError(friendlyConvertError(fetchError));
    } finally {
      setBusy(false);
    }
  }, []);

  const fetchPreview = useCallback(() => fetchPreviewFor(link), [fetchPreviewFor, link]);

  // Fresh state every time the dialog opens; an `initialUrl` prefills the
  // input and auto-advances straight to the preview step.
  useEffect(() => {
    if (!open) return;
    setStep('input');
    setLink(initialUrl ?? '');
    setLinkTouched(false);
    setBusy(false);
    setError(null);
    setPreview(null);
    setProgress(null);
    setLive([]);
    setResults([]);
    setSummary({ total: 0, matched: 0, approximate: 0, not_found: 0, error: 0 });
    setName('');
    setSelected(new Set());
    setSaving(false);
    setSavedId(null);
    setSavedCount(0);
    setSharedImport(false);
    abortRef.current?.abort();
    abortRef.current = null;
    if (initialUrl && initialUrl.trim()) {
      void fetchPreviewFor(initialUrl);
    }
  }, [open, initialUrl, fetchPreviewFor]);

  // Abandon in-flight work when the dialog closes mid-flight.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  const close = useCallback(() => {
    if (busy || saving) return;
    abortRef.current?.abort();
    onClose();
  }, [busy, saving, onClose]);

  /* ── act 2 (share): import the shared playlist directly ── */

  const importShared = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await importSharedPlaylist(link.trim());
      setSavedId(id);
      setSavedCount(preview?.trackCount ?? preview?.tracks.length ?? 0);
      setSharedImport(true);
      setStep('saved');
    } catch (importError) {
      setError(
        importError instanceof Error && importError.message
          ? importError.message
          : 'Could not import that shared playlist — please try again.',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, link, preview]);

  /* ── act 2 → 3: convert, streaming real progress ── */

  const startConversion = useCallback(async () => {
    if (!preview || busy || preview.kind === 'carmen-share') return;
    setBusy(true);
    setError(null);
    setLive([]);
    setProgress(null);
    setResults([]);
    setStep('converting');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const outcome = await convertImportSource(
        link.trim(),
        (...args: unknown[]) => {
          // The progress event is `{ done, total, result }`; tolerate the
          // positional `(done, total, result)` shape as well so the live
          // counters render whichever the client emits.
          let done = 0;
          let total = preview.trackCount;
          let result: TrackConversion | undefined;
          const first = args[0] as { done?: unknown; total?: unknown; result?: unknown } | null;
          if (first && typeof first === 'object' && 'result' in first) {
            done = Number(first.done ?? 0);
            total = Number(first.total ?? preview.trackCount);
            result = first.result as TrackConversion;
          } else if (typeof args[0] === 'number') {
            done = args[0];
            total = Number(args[1] ?? preview.trackCount);
            result = args[2] as TrackConversion | undefined;
          }
          if (!result) return;
          setProgress({ done, total, result });
          setLive((previous) => [...previous, result as TrackConversion]);
        },
        controller.signal,
        Math.min(200, Math.max(preview.trackCount, 1)),
      );
      const converted = Array.isArray(outcome) ? outcome : [];
      setResults(converted);
      setSummary({
        total: converted.length,
        matched: converted.filter((result) => result.status === 'matched').length,
        approximate: converted.filter((result) => result.status === 'approximate').length,
        not_found: converted.filter((result) => result.status === 'not_found').length,
        error: converted.filter((result) => result.status === 'error').length,
      });
      setSelected(
        new Set(
          converted
            .filter((result) => result.match && result.status !== 'not_found')
            .map((result) => result.source.id),
        ),
      );
      setStep('results');
    } catch (convertError) {
      if ((convertError as Error)?.name === 'AbortError') {
        setStep('preview');
        return;
      }
      setError(friendlyConvertError(convertError));
      setStep('preview');
    } finally {
      setBusy(false);
    }
  }, [preview, link, busy]);

  const cancelConversion = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ── act 4: save the picks as a library playlist ── */

  const toggleSelected = useCallback((id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectable = useMemo(
    () => results.filter((result) => result.match && result.status !== 'not_found'),
    [results],
  );
  const allSelected = selectable.length > 0 && selectable.every((result) => selected.has(result.source.id));

  const toggleAll = useCallback(() => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectable.map((result) => result.source.id)));
  }, [allSelected, selectable]);

  const save = useCallback(async () => {
    if (saving || selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const picks = results.filter((result) => selected.has(result.source.id));
      const id = await saveConversionAsPlaylist(results, {
        name: name.trim() || preview?.name || `Imported from ${sourceLabel}`,
        selected: picks,
        description: preview
          ? `Imported from ${sourceLabel} · “${preview.name}”`
          : `Imported from ${sourceLabel}`,
      });
      setSavedId(id);
      setSavedCount(picks.filter((pick) => pick.match).length);
      setStep('saved');
    } catch {
      setError('Could not save the playlist — please try again.');
    } finally {
      setSaving(false);
    }
  }, [saving, selected, results, name, preview, sourceLabel]);

  const progressPercent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <Dialog open={open} onClose={close} maxWidth="md" className="!rounded-[28px]">
      <DialogTitle className="!pb-1">
        <div className="flex items-center gap-3 pr-10">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
              !spotify && 'bg-accent/15',
            )}
            style={spotify ? { background: 'rgba(29,185,84,0.14)' } : undefined}
          >
            <SourceMark size={26} kind={activeKind} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-lg font-bold leading-7">Import a playlist</span>
            <span className="block break-words text-xs font-normal leading-5 text-muted">
              {isShare
                ? 'Carmen shared playlist → your library'
                : `${sourceLabel === 'Imported source' ? 'Spotify, Apple Music, YouTube or a Carmen share' : sourceLabel} → YouTube Music matches → your library`}
            </span>
          </span>
        </div>
        <IconButton
          aria-label="Close"
          onClick={close}
          disabled={busy || saving}
          className="!absolute right-2 top-2"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent className="!px-4 sm:!px-6">
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-3 rounded-2xl border border-[rgba(229,72,77,0.35)] bg-[rgba(229,72,77,0.08)] px-4 py-3"
          >
            <CloseIcon style={{ fontSize: 18, color: '#e5484d', marginTop: 2 }} />
            <p className="m-0 min-w-0 flex-1 text-sm leading-6 text-body">{error}</p>
          </div>
        )}

        {step === 'input' && (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="pb-2"
          >
            <div
              className="mb-5 overflow-hidden rounded-3xl border border-line px-5 py-6 text-center sm:px-8 sm:py-8"
              style={
                spotify
                  ? {
                      background:
                        'radial-gradient(120% 140% at 50% 0%, rgba(29,185,84,0.16) 0%, rgba(29,185,84,0.03) 55%, transparent 100%)',
                    }
                  : undefined
              }
            >
              <div className="mb-3 flex justify-center">
                <span
                  className={cn(
                    'flex h-16 w-16 items-center justify-center rounded-full',
                    !spotify && 'bg-accent/15',
                  )}
                  style={
                    spotify
                      ? { background: 'rgba(29,185,84,0.16)', boxShadow: '0 0 44px rgba(29,185,84,0.35)' }
                      : undefined
                  }
                >
                  <SourceMark size={34} kind={activeKind} />
                </span>
              </div>
              <p className="m-0 text-xl font-bold leading-8 sm:text-2xl sm:leading-9">
                Bring your playlists home
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted">
                {isShare
                  ? 'That\u2019s a Carmen share link — preview the shared playlist and save a copy straight into your library, no conversion needed.'
                  : 'Paste a link — we read every song from the source and find its twin on YouTube Music, ready to play in Carmen.'}
              </p>
            </div>

            <TextField
              autoFocus={!initialUrl}
              fullWidth
              label="Playlist link"
              placeholder="https://open.spotify.com/playlist/…"
              value={link}
              onChange={(event) => {
                setLink(event.target.value);
                setLinkTouched(true);
              }}
              disabled={busy}
              error={showLinkError}
              helperText={
                showLinkError
                  ? 'That doesn\u2019t look like a supported link.'
                  : 'Supported: Spotify playlists, albums, tracks & artists · Apple Music albums · YouTube / YouTube Music videos & playlists · Carmen share links or codes. Public sources only.'
              }
              inputProps={{
                inputMode: 'url',
                autoCapitalize: 'off',
                autoCorrect: 'off',
                spellCheck: false,
                'aria-label': 'Playlist link',
                onKeyDown: (event: React.KeyboardEvent) => {
                  if (event.key === 'Enter') void fetchPreview();
                },
              }}
            />

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                ['1', 'Paste the link', 'Spotify, Apple, YouTube or Carmen'],
                ['2', 'Preview it', 'Cover, songs and track count'],
                ['3', 'Convert & save', 'Matched songs land in your library'],
              ].map(([number, title, hint]) => (
                <div key={number} className="rounded-2xl border border-line bg-surface px-3 py-2.5">
                  <p className="m-0 flex items-center gap-2 text-sm font-semibold">
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                        !spotify && 'bg-accent/15 text-accent',
                      )}
                      style={spotify ? { background: 'rgba(29,185,84,0.16)', color: SPOTIFY_GREEN } : undefined}
                    >
                      {number}
                    </span>
                    {title}
                  </p>
                  <p className="m-0 mt-0.5 pl-8 text-xs leading-5 text-muted">{hint}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {step === 'preview' && preview && (
          <motion.div key="preview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Artwork
                src={preview.artwork}
                alt=""
                icon={MusicNoteIcon as never}
                iconSize={40}
                className="shrink-0"
                style={{
                  width: '100%',
                  maxWidth: 168,
                  aspectRatio: '1 / 1',
                  borderRadius: 24,
                  boxShadow: 'var(--shadow-elev-1)',
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted">
                  {importKindLabel(preview.kind)}
                </p>
                <h3 className="m-0 mt-0.5 break-words text-xl font-bold leading-8">{preview.name}</h3>
                <p className="m-0 mt-1 text-sm leading-6 text-muted">
                  {preview.owner && <span>by {preview.owner} · </span>}
                  {preview.trackCount} song{preview.trackCount === 1 ? '' : 's'}
                </p>
                {preview.description && (
                  <p className="m-0 mt-1 line-clamp-2 text-xs leading-5 text-disabled">
                    {preview.description.replace(/<[^>]*>/g, '')}
                  </p>
                )}
                {isShare && (
                  <p className="m-0 mt-1 text-xs leading-5 text-disabled">
                    Shared with you through Carmen — importing saves your own copy.
                  </p>
                )}
              </div>
            </div>

            <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {isShare ? 'Songs' : 'First songs'}
            </p>
            <ol className="m-0 mb-2 list-none p-0">
              {preview.tracks.slice(0, 6).map((track, index) => (
                <li
                  key={track.id}
                  className="flex min-w-0 items-center gap-3 border-b border-line py-2 last:border-0"
                >
                  <span className="w-6 shrink-0 text-center text-xs font-semibold text-disabled">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <MarqueeText text={track.title} variant="body2" sx={{ fontWeight: 600 }} />
                    <span className="block truncate text-xs leading-5 text-muted">{track.artist}</span>
                  </span>
                </li>
              ))}
            </ol>
            {preview.trackCount > 6 && (
              <p className="m-0 mb-1 text-xs leading-5 text-disabled">
                …and {preview.trackCount - 6} more
              </p>
            )}
          </motion.div>
        )}

        {step === 'converting' && (
          <motion.div
            key="converting"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="py-4"
          >
            <div className="mb-5 text-center">
              <p className="m-0 text-5xl font-bold tabular-nums leading-none" style={{ color: accentColor }}>
                {Math.round(progressPercent)}
                <span className="text-2xl">%</span>
              </p>
              <p className="m-0 mt-2 text-sm leading-6 text-muted">
                {progress ? (
                  <>
                    Matching song {progress.done} of {progress.total} ·{' '}
                    {live.filter((r) => r.status === 'matched').length} matched ·{' '}
                    {live.filter((r) => r.status === 'approximate').length} close
                  </>
                ) : (
                  'Warming up…'
                )}
              </p>
            </div>
            <Meter value={progressPercent} spotify={spotify} />
            <div className="mt-5 min-h-[44px] rounded-2xl border border-line bg-surface px-4 py-2.5">
              {progress ? (
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <Spinner size={16} />
                  <span className="min-w-0 flex-1">
                    <MarqueeText
                      text={`${progress.result.source.title} — ${progress.result.source.artist}`}
                      variant="body2"
                    />
                  </span>
                </div>
              ) : (
                <p className="m-0 text-sm leading-6 text-muted">Reading the source…</p>
              )}
            </div>
            <p className="m-0 mt-4 text-center text-xs leading-5 text-disabled">
              Matching each song on YouTube Music — long playlists can take a minute.
            </p>
          </motion.div>
        )}

        {step === 'results' && (
          <motion.div key="results" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {(
                [
                  ['matched', summary.matched, 'Matched'],
                  ['approximate', summary.approximate, 'Close'],
                  ['not_found', summary.not_found + summary.error, 'No match'],
                ] as const
              ).map(([key, count, label]) => (
                <div
                  key={key}
                  className="rounded-2xl border border-line px-3 py-2.5 text-center"
                  style={{ background: STATUS_META[key].bg }}
                >
                  <p className="m-0 text-2xl font-bold tabular-nums leading-8" style={{ color: STATUS_META[key].color }}>
                    {count}
                  </p>
                  <p className="m-0 text-xs leading-5 text-muted">{label}</p>
                </div>
              ))}
            </div>

            <TextField
              fullWidth
              label="Playlist name in your library"
              value={name}
              onChange={(event) => setName(event.target.value)}
              margin="dense"
              inputProps={{ maxLength: 120 }}
            />

            <div className="mb-1 mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={toggleAll}
                className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-1 text-sm font-medium text-muted"
              >
                <RowCheckbox checked={allSelected} onChange={toggleAll} label="Select all matched songs" spotify={spotify} />
                {selected.size} of {selectable.length} selected
              </button>
              <span className="text-xs leading-5 text-disabled">Unmatched songs can’t be saved</span>
            </div>

            <ul className="m-0 list-none p-0">
              {results.map((result) => {
                const usable = Boolean(result.match) && result.status !== 'not_found';
                const checked = selected.has(result.source.id);
                const rowLabel = importKindLabel(
                  (result.source as unknown as Record<string, unknown>)?.source ?? preview?.kind,
                );
                const matchTitle =
                  result.match && typeof result.match.title === 'string' ? result.match.title : '';
                const matchArtist =
                  result.match && Array.isArray(result.match.artists)
                    ? result.match.artists
                        .map((artist: unknown) =>
                          typeof artist === 'string' ? artist : (artist as { name?: string })?.name,
                        )
                        .filter(Boolean)
                        .join(', ')
                    : '';
                return (
                  <li
                    key={result.source.id}
                    className={cn(
                      'flex min-w-0 items-start gap-3 border-b border-line py-2.5 last:border-0',
                      !usable && 'opacity-60',
                    )}
                  >
                    <span className="mt-0.5">
                      <RowCheckbox
                        checked={checked}
                        onChange={() => usable && toggleSelected(result.source.id)}
                        label={`Include ${result.source.title}`}
                        spotify={spotify}
                      />
                    </span>
                    <button
                      type="button"
                      disabled={!usable}
                      onClick={() => toggleSelected(result.source.id)}
                      className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 border-0 bg-transparent p-0 text-left disabled:cursor-default"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
                          <MarqueeText text={result.source.title} variant="body2" sx={{ fontWeight: 600 }} />
                          <span className="block truncate text-xs leading-5 text-muted">
                            {result.source.artist}
                            <span className="text-disabled"> · {rowLabel}</span>
                          </span>
                        </span>
                        <StatusPill status={result.status} confidence={result.confidence} />
                      </span>
                      {result.match ? (
                        <span className="block min-w-0 truncate text-xs leading-5 text-muted">
                          <span style={{ color: accentColor }}>→ </span>
                          {matchTitle}
                          {matchArtist && <span> — {matchArtist}</span>}
                        </span>
                      ) : (
                        <span className="block text-xs leading-5 text-disabled">
                          {result.status === 'error'
                            ? `Search failed${result.error ? `: ${result.error}` : ''}`
                            : 'No close match on YouTube Music'}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}

        {step === 'saved' && (
          <motion.div
            key="saved"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="py-6 text-center"
          >
            <motion.span
              initial={{ scale: 0.6 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className={cn(
                'mb-4 inline-flex h-20 w-20 items-center justify-center rounded-full',
                !spotify && 'bg-accent/15',
              )}
              style={spotify ? { background: 'rgba(29,185,84,0.14)' } : undefined}
            >
              <CheckCircleIcon style={{ fontSize: 44, color: accentColor }} />
            </motion.span>
            <p className="m-0 text-xl font-bold leading-8">Playlist saved</p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted">
              <span className="font-semibold text-body">{name.trim() || preview?.name}</span>
              {' '}is in your library with {savedCount} song{savedCount === 1 ? '' : 's'}.
            </p>
            <div className="mt-3 flex justify-center">
              {sharedImport ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${savedCount} song${savedCount === 1 ? '' : 's'} copied from a Carmen share`}
                />
              ) : (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${summary.matched + summary.approximate} converted · ${summary.not_found + summary.error} had no match`}
                />
              )}
            </div>
          </motion.div>
        )}
      </DialogContent>

      <DialogActions className="flex-wrap !justify-between gap-2">
        <div>
          {(step === 'preview' || step === 'results') && (
            <Button onClick={() => (step === 'preview' ? setStep('input') : setStep('preview'))} disabled={busy || saving}>
              Back
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {step === 'input' && (
            <Button
              variant="contained"
              onClick={() => void fetchPreview()}
              disabled={!linkValid || busy}
              startIcon={busy ? <Spinner size={18} /> : <SourceMark size={18} kind={activeKind} />}
              className={primaryClass}
            >
              {busy ? 'Fetching…' : 'Preview'}
            </Button>
          )}
          {step === 'preview' && !isShare && (
            <Button
              variant="contained"
              onClick={() => void startConversion()}
              disabled={busy}
              startIcon={busy ? <Spinner size={18} /> : <SourceMark size={18} kind={activeKind} />}
              className={primaryClass}
            >
              Convert to YouTube Music
            </Button>
          )}
          {step === 'preview' && isShare && (
            <Button
              variant="contained"
              onClick={() => void importShared()}
              disabled={busy}
              startIcon={busy ? <Spinner size={18} /> : <SourceMark size={18} kind={activeKind} />}
              className={primaryClass}
            >
              {busy ? 'Importing…' : 'Import to library'}
            </Button>
          )}
          {step === 'converting' && (
            <Button onClick={cancelConversion} color="error">
              Cancel
            </Button>
          )}
          {step === 'results' && (
            <Button
              variant="contained"
              onClick={() => void save()}
              disabled={selected.size === 0 || saving}
              startIcon={saving ? <Spinner size={18} /> : undefined}
              className={primaryClass}
            >
              {saving ? 'Saving…' : `Save to library (${selected.size})`}
            </Button>
          )}
          {step === 'saved' && (
            <>
              <Button onClick={close}>Done</Button>
              <Button
                variant="contained"
                onClick={() => savedId !== null && onOpenPlaylist(savedId)}
                className={primaryClass}
              >
                Open playlist
              </Button>
            </>
          )}
        </div>
      </DialogActions>
    </Dialog>
  );
}
