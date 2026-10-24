/**
 * Share a playlist — publishes (or updates) the playlist in the server's
 * share registry and shows everything needed to hand it to someone else:
 * the link, the short code, a QR code and the system share sheet.
 *
 * Re-sharing is deliberate: `sharePlaylistOnline` re-uses the code this
 * playlist already has, so the link stays stable and the shared copy is
 * updated in place instead of minting a new URL every time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

import { Button, IconButton, Spinner } from '../../components/ui';
import { Dialog, DialogActions, DialogContent, DialogTitle } from '../../components/ui/Overlay';
import { ShareIcon } from '../../components/icons';
import { sharePlaylistOnline } from '../../services/playlistShare';
import type { Playlist, PlaylistSong } from '../../types/models';
import { notify } from '../../utils/downloadsStore';
import { CloseIcon } from './glyphs';

interface SharePlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  playlist: Playlist;
  songs: PlaylistSong[];
}

type ShareState =
  | { status: 'loading' }
  | { status: 'ready'; code: string; url: string; qrDataUrl: string | null }
  | { status: 'error'; message: string };

/** Clipboard copy with the legacy fallback `utils/share.ts` uses for songs. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

export default function SharePlaylistDialog({
  open,
  onClose,
  playlist,
  songs,
}: SharePlaylistDialogProps) {
  const [state, setState] = useState<ShareState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // The songs a (re)share publishes are the ones the dialog opened with —
  // freeze them per attempt so a background list reload can't swap the
  // payload mid-flight.
  const songsRef = useRef(songs);
  if (open) songsRef.current = songs;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    sharePlaylistOnline(playlist, songsRef.current)
      .then(async ({ code, url }: { code: string; url: string }) => {
        if (cancelled) return;
        let qrDataUrl: string | null = null;
        try {
          qrDataUrl = await QRCode.toDataURL(url, { width: 240, margin: 1 });
        } catch {
          /* the link and code still work without the QR image */
        }
        if (!cancelled) setState({ status: 'ready', code, url, qrDataUrl });
      })
      .catch((shareError: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message:
            shareError instanceof Error && shareError.message
              ? shareError.message
              : 'Could not share this playlist — please try again.',
        });
      });
    return () => {
      cancelled = true;
    };
    // `attempt` is the retry trigger; playlist identity is stable per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt, playlist.id]);

  const copyLink = useCallback(async (url: string) => {
    const copied = await copyText(url);
    notify(copied ? 'success' : 'error', copied ? 'Link copied to clipboard' : 'Could not copy the link');
  }, []);

  const shareNative = useCallback(
    async (url: string) => {
      // Playlist shares deliberately use the system sheet when one exists
      // (song shares stay copy-only — see `utils/share.ts`).
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        try {
          await navigator.share({
            title: playlist.name,
            text: `Listen to "${playlist.name}" on Carmen`,
            url,
          });
          return;
        } catch (shareError) {
          // The user dismissing the sheet is not an error and not a copy.
          if (shareError instanceof Error && shareError.name === 'AbortError') return;
          /* any other failure falls through to copying the link */
        }
      }
      await copyLink(url);
    },
    [copyLink, playlist.name],
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        Share playlist
        <span className="block break-words text-xs font-normal leading-[1.4] text-muted">
          {playlist.name} · {songs.length} track{songs.length === 1 ? '' : 's'}
        </span>
        <IconButton aria-label="Close" onClick={onClose} className="!absolute right-2 top-2">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {state.status === 'loading' && (
          <div className="grid place-items-center gap-3 py-8">
            <Spinner size={26} />
            <span className="text-xs leading-[1.4] text-muted">Publishing the share link…</span>
          </div>
        )}

        {state.status === 'error' && (
          <div className="py-4 text-center">
            <p className="m-0 text-sm font-semibold">Sharing failed</p>
            <span className="text-xs leading-[1.4] text-muted">{state.message}</span>
            <div className="mt-4">
              <Button variant="contained" onClick={() => setAttempt((value) => value + 1)}>
                Try again
              </Button>
            </div>
          </div>
        )}

        {state.status === 'ready' && (
          <div className="flex flex-col items-center gap-3 py-2">
            {state.qrDataUrl && (
              <img
                src={state.qrDataUrl}
                alt={`QR code for the share link of ${playlist.name}`}
                width={200}
                height={200}
                className="rounded-[14px] bg-white p-2"
              />
            )}

            <label className="w-full">
              <span className="mb-1 block text-xs font-medium text-muted">Share link</span>
              <span className="flex items-center gap-2">
                <input
                  readOnly
                  value={state.url}
                  aria-label="Share link"
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-[14px] border border-line bg-transparent px-3 py-2 text-sm text-body outline-none"
                />
                <Button variant="contained" onClick={() => void copyLink(state.url)}>
                  Copy
                </Button>
              </span>
            </label>

            {state.code.startsWith('plz_') ? (
              <>
                <p className="m-0 text-center text-sm leading-[1.43] text-muted">
                  Self-contained link — works without a Carmen server
                </p>
                <span className="text-center text-xs leading-[1.4] text-disabled">
                  This link carries the playlist inside it — anyone who opens it
                  gets this exact snapshot of the playlist.
                </span>
              </>
            ) : (
              <>
                <p className="m-0 text-sm leading-[1.43] text-muted">
                  Share code: <span className="font-mono font-semibold text-body">{state.code}</span>
                </p>

                <span className="text-center text-xs leading-[1.4] text-disabled">
                  Re-sharing this playlist updates the same link — anyone who has it
                  always opens the latest version.
                </span>
              </>
            )}
          </div>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {state.status === 'ready' && (
          <Button
            variant="contained"
            startIcon={<ShareIcon fontSize="small" />}
            onClick={() => void shareNative(state.url)}
          >
            Share
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
