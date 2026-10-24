/**
 * Shared-playlist boot gate.
 *
 * A Carmen playlist share link carries its code in the **query string**
 * (`https://host/?pl=pl_…`) — the hash belongs to HashRouter, so the code
 * never travels in it. This gate, mounted once inside the router at app
 * boot, reads `?pl=` exactly once, strips it from the address bar with
 * `history.replaceState` (the hash route is left byte-for-byte alone),
 * resolves the code and asks "Import this playlist?" before anything is
 * saved. Confirming imports a copy through the normal playlist repos and
 * lands on the Library; cancelling — or any failure — simply dismisses
 * (failures are notified, never only logged).
 *
 * With no `pl` parameter the gate renders nothing and does nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Spinner } from './ui';
import { importSharedPlaylist, resolveSharedPlaylist, type SharedPlaylistPayload } from '../services/playlistShare';
import { notify } from '../utils/downloadsStore';

/** Display title of one shared track, whatever shape the payload uses. */
function trackTitle(track: unknown): string {
  if (track && typeof track === 'object') {
    const title = (track as Record<string, unknown>).title;
    if (typeof title === 'string' && title) return title;
  }
  return 'Untitled';
}

export default function SharedPlaylistGate() {
  const navigate = useNavigate();
  const [shared, setShared] = useState<SharedPlaylistPayload | null>(null);
  const [code, setCode] = useState('');
  const [importing, setImporting] = useState(false);
  // Strict-mode double effects (and any remount) must not resolve or
  // prompt twice for the same boot link.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let pl: string | null = null;
    try {
      pl = new URLSearchParams(window.location.search).get('pl');
    } catch {
      pl = null;
    }
    if (!pl) return;

    // Strip the parameter immediately — before resolving — so a refresh
    // or a route restore never re-prompts for the same link. Only the
    // query string is rewritten; the hash route is preserved untouched.
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete('pl');
      const rest = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
      );
    } catch {
      // Stripping is best-effort; resolving still proceeds.
    }

    let cancelled = false;
    resolveSharedPlaylist(pl)
      .then((payload) => {
        if (cancelled) return;
        setCode(pl as string);
        setShared(payload);
      })
      .catch((resolveError: unknown) => {
        if (cancelled) return;
        notify(
          'error',
          resolveError instanceof Error && resolveError.message
            ? resolveError.message
            : 'That shared playlist could not be found.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    if (importing) return;
    setShared(null);
  };

  const confirm = async () => {
    if (!shared || importing) return;
    setImporting(true);
    try {
      await importSharedPlaylist(code || shared.code);
      notify('success', `Imported “${shared.name}” to your library`);
      setShared(null);
      navigate('/library');
    } catch (importError) {
      notify(
        'error',
        importError instanceof Error && importError.message
          ? importError.message
          : 'Could not import that shared playlist — please try again.',
      );
      setShared(null);
    } finally {
      setImporting(false);
    }
  };

  if (!shared) return null;

  const tracks = Array.isArray(shared.tracks) ? shared.tracks : [];
  const firstTitles = tracks.slice(0, 3).map((track) => trackTitle(track));

  return (
    <Dialog open onClose={dismiss} maxWidth="xs" fullWidth aria-label="Import shared playlist">
      <DialogTitle>Import this playlist?</DialogTitle>
      <DialogContent>
        <p className="m-0 text-sm leading-6 text-body">
          <span className="font-semibold">{shared.name}</span>
          {' — '}
          {tracks.length} song{tracks.length === 1 ? '' : 's'} shared with you through Carmen.
        </p>
        {firstTitles.length > 0 && (
          <p className="m-0 mt-2 text-sm leading-6 text-muted">
            {firstTitles.join(' · ')}
            {tracks.length > firstTitles.length ? ' · …' : ''}
          </p>
        )}
        {shared.description ? (
          <p className="m-0 mt-2 text-xs leading-5 text-disabled">{shared.description}</p>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={dismiss} disabled={importing}>
          Not now
        </Button>
        <Button
          variant="contained"
          onClick={() => void confirm()}
          disabled={importing}
          startIcon={importing ? <Spinner size={18} /> : undefined}
        >
          {importing ? 'Importing…' : 'Import playlist'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
