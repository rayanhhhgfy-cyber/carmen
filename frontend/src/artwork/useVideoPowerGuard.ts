import { useEffect, type RefObject } from 'react';

import { isTauri } from '../platform/env';

/**
 * Keeps a decorative MP4 loop from burning GPU while nobody can see it.
 *
 * Three independent signals veto playback and every one of them is enough
 * to pause the element immediately:
 *
 *  1. **the document is hidden** — window minimized, app hidden (Cmd+H),
 *     another Space/mission-control view;
 *  2. **the window lost focus** — through the Tauri window event (the
 *     native signal, fires even when the WebView itself never reports a
 *     blur) plus the plain `blur`/`focus` pair as the browser fallback;
 *  3. **the element left the viewport** — an `IntersectionObserver` at
 *     threshold 0, which also covers a panel scrolled out of sight.
 *
 * Playback only resumes when *all three* allow it again and the element is
 * still mounted (closing the sheet unmounts the video outright, so `play()`
 * can never resurrect a dismissed loop). The hook is stateless on purpose:
 * it writes straight to the media element, so a window blip costs zero
 * React renders.
 *
 * `preload="metadata"` on the element (see PlayerSheet) keeps the first
 * paint cheap; the loop itself only starts fetching once `play()` runs.
 *
 * @param videoRef the loop's element — may be `null` while the URL resolves
 * @param active  flips true when the element is (about to be) mounted, so
 *                the guard attaches even though a ref alone never re-renders
 */
export function useVideoPowerGuard(
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    // Unknown states start optimistic so an environment without focus/IO
    // events (plain vite dev in some browsers) never freezes the loop.
    let documentVisible = !document.hidden;
    let windowFocused = document.hasFocus();
    let inViewport = true;
    let disposed = false;
    let unlistenFocus: (() => void) | undefined;

    const apply = () => {
      if (disposed) return;
      if (documentVisible && windowFocused && inViewport) {
        if (video.paused) void video.play().catch(() => undefined);
      } else if (!video.paused) {
        video.pause();
      }
    };

    const onVisibility = () => {
      documentVisible = !document.hidden;
      apply();
    };
    const onBlur = () => {
      windowFocused = false;
      apply();
    };
    const onFocus = () => {
      windowFocused = true;
      apply();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    // Native signal: minimize/hide/quit-focus all surface here even when
    // the WebView's own blur events do not fire.
    if (isTauri) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().onFocusChanged((event) => {
          windowFocused = event.payload;
          apply();
        }))
        .then((stop) => {
          if (disposed) stop();
          else unlistenFocus = stop;
        })
        .catch(() => undefined);
    }

    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            inViewport = entries.some((entry) => entry.isIntersecting);
            apply();
          })
        : undefined;
    observer?.observe(video);

    apply();

    return () => {
      disposed = true;
      observer?.disconnect();
      unlistenFocus?.();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [videoRef, active]);
}
