/**
 * Settings → App: install Carmen on this device.
 *
 * The row's shape depends on what the browser can actually do (see
 * `services/pwaInstall`): a real Install button on Chromium browsers
 * that fired `beforeinstallprompt`, an "already installed" line when
 * running standalone, Share → Add to Home Screen instructions on iOS
 * Safari (which has no prompt), and nothing at all anywhere else —
 * a dead button on a browser that cannot install would be worse than
 * no row. The Tauri shell never shows this row: it is already installed.
 */
import { useState, useSyncExternalStore } from 'react';

import { Button } from './ui';
import { isTauri } from '../platform/env';
import {
  getPwaInstallSnapshot,
  promptPwaInstall,
  subscribePwaInstall,
} from '../services/pwaInstall';

export default function PwaInstallRow() {
  const snap = useSyncExternalStore(
    subscribePwaInstall,
    getPwaInstallSnapshot,
    getPwaInstallSnapshot,
  );
  const [busy, setBusy] = useState(false);

  if (isTauri) return null;

  if (snap.installed) {
    return (
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-sm leading-[1.43] font-semibold">Install Carmen</p>
          <span className="block text-xs leading-[1.4] text-muted">
            Carmen is installed on this device.
          </span>
        </div>
      </div>
    );
  }

  if (snap.canInstall) {
    return (
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-sm leading-[1.43] font-semibold">Install Carmen</p>
          <span className="block text-xs leading-[1.4] text-muted">
            Add Carmen to this device so it opens on its own — and works offline
            with your downloaded songs.
          </span>
        </div>
        <Button
          className="shrink-0"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void promptPwaInstall().finally(() => setBusy(false));
          }}
        >
          {busy ? 'Installing…' : 'Install app'}
        </Button>
      </div>
    );
  }

  if (snap.dismissed) {
    return (
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-sm leading-[1.43] font-semibold">Install Carmen</p>
          <span className="block text-xs leading-[1.4] text-muted">
            You dismissed the install prompt — reload the page if you change your mind.
          </span>
        </div>
      </div>
    );
  }

  if (snap.isIos) {
    return (
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="m-0 text-sm leading-[1.43] font-semibold">Install Carmen</p>
          <span className="block text-xs leading-[1.4] text-muted">
            On iPhone: tap Share, then Add to Home Screen. Songs downloaded inside
            the installed app stay in it — they are not shared with Safari.
          </span>
        </div>
      </div>
    );
  }

  return null;
}
