/**
 * PWA install prompt capture.
 *
 * Chromium browsers fire `beforeinstallprompt` exactly once per page load
 * (and only when the app meets the installability checks — manifest +
 * service worker, which the PWA build provides). The listener therefore
 * has to attach at startup — `main.tsx` calls `initPwaInstall()` before
 * rendering — because a listener mounted later (e.g. in Settings) would
 * miss an event that already fired.
 *
 * iOS Safari never fires this event: there the install path is
 * Share → Add to Home Screen, so Settings shows those instructions
 * instead of a button. The Tauri shell never uses this module at all —
 * it is already installed — so `main.tsx` only initialises it on web.
 */

export interface PwaInstallSnapshot {
  /** The app is running installed (standalone display mode / web clip). */
  installed: boolean;
  /** A real install prompt is available to show right now. */
  canInstall: boolean;
  /** The user dismissed the prompt this session (it returns on reload). */
  dismissed: boolean;
  /** iOS Safari: no prompt exists, show the manual instructions. */
  isIos: boolean;
}

/** The subset of `BeforeInstallPromptEvent` this module uses (not in TS's DOM lib). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let deferred: InstallPromptEvent | null = null;
let dismissed = false;
let installed = false;

function computeInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* matchMedia unavailable — fall through to the iOS check */
  }
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function computeIsIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    (navigator as Navigator & { standalone?: boolean }).standalone !== true
  );
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Attach the prompt listeners. Called once, at startup, on web only. */
export function initPwaInstall(): void {
  if (typeof window === 'undefined') return;
  installed = computeInstalled();
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the browser's own mini-infobar — Settings owns the button.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    dismissed = false;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export function subscribePwaInstall(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaInstallSnapshot(): PwaInstallSnapshot {
  return {
    installed,
    canInstall: deferred !== null && !installed,
    dismissed,
    isIos: computeIsIos(),
  };
}

/**
 * Shows the captured install prompt. A prompt can only be shown once per
 * event — after a dismissal the button gives way to a "reload to try
 * again" note until the browser fires a fresh event.
 */
export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | null> {
  if (!deferred) return null;
  const event = deferred;
  try {
    await event.prompt();
    const choice = await event.userChoice?.catch(() => undefined);
    if (choice?.outcome === 'accepted') {
      deferred = null;
      installed = true;
      emit();
      return 'accepted';
    }
  } catch {
    /* prompting failed — fall through to the dismissed state */
  }
  deferred = null;
  dismissed = true;
  emit();
  return 'dismissed';
}
