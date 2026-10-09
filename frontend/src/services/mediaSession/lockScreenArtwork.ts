/**
 * iOS lock-screen animated artwork — a hidden, muted, looping `<video>` whose
 * current frame iOS projects onto the lock screen / Control Center artwork
 * while the audio session plays. It mirrors the `<audio>` (play / pause /
 * playback rate) and nothing else: **no** `currentTime` seeking, no visible
 * UI, and the Now Playing page keeps its own, separate pipeline
 * (`artwork/motion.ts`) untouched.
 *
 * Source order per track — "loaded once, served from storage after that":
 *
 *   1. Cache API hit — the background MP4 downloaded the first time this
 *      track played (`carmen-motion-v1`, keyed per video id),
 *   2. otherwise resolve the `.m3u8` master (the `test.py`/coverpy chain,
 *      translated in `artwork/motion.ts` → `lockScreenMotionUrls`): iOS
 *      Safari plays HLS natively so the first play streams immediately,
 *      while the self-contained MP4 behind `#EXT-X-MAP` downloads into the
 *      cache for every repeat play.
 *
 * Degradation is silent and complete: Apple only sends CORS headers for its
 * own origins, so in a plain web session resolution fails (at most once per
 * session — `lockScreenMotionUrls` latches) and this hook simply keeps no
 * video at all; the static `metadata.artwork` stays the fallback. Same when
 * the Cache API is unavailable, when the setting is off, or on any platform
 * other than iOS — where this hook does nothing at all.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { lockScreenMotionUrls, type MotionArtworkRef } from '../../artwork/motion';
import { isIOS } from '../../services/env';
import {
  DEFAULT_SETTINGS,
  getSettingsSnapshot,
  subscribeSettings,
} from '../../settings/store';

/** Cache of background MP4 downloads — one entry per track id. */
const MOTION_CACHE = 'carmen-motion-v1';

function motionCacheRequest(videoId: string): Request {
  // Synthetic same-origin key — Cache Storage only needs a stable URL as the
  // key; the bytes inside came from mzstatic.
  return new Request(`/carmen-motion/${videoId}.mp4`);
}

let videoElement: HTMLVideoElement | null = null;
let activeObjectUrl: string | null = null;

function revokeActiveObjectUrl(): void {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

/**
 * The one hidden element for the whole app: 120×120, essentially transparent
 * (`0.0001`, not `0` — fully transparent media can drop out of the compositor
 * that iOS projects from), inert, behind everything. No `crossorigin` — the
 * HLS master and mzstatic MP4 are consumed exactly as Safari's native player
 * would.
 */
function artworkVideo(): HTMLVideoElement {
  if (videoElement) return videoElement;
  const video = document.createElement('video');
  video.playsInline = true; // iOS: never go fullscreen
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.loop = true;
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = [
    'position:fixed',
    'left:0',
    'bottom:0',
    'width:120px',
    'height:120px',
    'opacity:0.0001',
    'pointer-events:none',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(video);
  videoElement = video;
  return video;
}

/** Background: download the self-contained MP4 into the per-track cache. */
async function cacheMotion(videoId: string, mp4: string): Promise<void> {
  try {
    const response = await fetch(mp4);
    if (!response.ok) return;
    const cache = await caches.open(MOTION_CACHE);
    await cache.put(motionCacheRequest(videoId), response);
  } catch {
    /* offline / blocked — the next play simply resolves again */
  }
}

export function useLockScreenArtwork(
  reference: MotionArtworkRef | null,
  audioRef: React.RefObject<HTMLAudioElement | null>,
): void {
  const enabled = useSyncExternalStore(
    subscribeSettings,
    () => getSettingsSnapshot().iosLockScreenArtwork,
    () => DEFAULT_SETTINGS.iosLockScreenArtwork,
  );

  useEffect(() => {
    // iOS-only *in effect* (the Settings row is shown everywhere): the
    // projection trick simply does not exist on other platforms.
    if (!isIOS || !enabled || !reference?.videoId) return undefined;
    const videoId = reference.videoId;
    const audio = audioRef.current;
    const video = artworkVideo();
    let cancelled = false;

    // Mirror of the audio's transport — event-driven, never a poll.
    const mirror = (): void => {
      if (!audio || !video.getAttribute('src')) return;
      if (audio.paused || audio.ended) {
        video.pause();
        return;
      }
      const rate = audio.playbackRate;
      if (rate && rate > 0 && video.playbackRate !== rate) {
        try {
          video.playbackRate = rate;
        } catch {
          /* some rates are refused by the decoder — keep the native one */
        }
      }
      const attempt = video.play();
      if (attempt) attempt.catch(() => {}); // gesture rules — silent
    };
    const onPlay = (): void => mirror();
    const onPause = (): void => video.pause();
    const onEnded = (): void => video.pause();
    const onRateChange = (): void => mirror();
    // A failed stream degrades to "no video": the static cover stays.
    const onError = (): void => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    audio?.addEventListener('play', onPlay);
    audio?.addEventListener('pause', onPause);
    audio?.addEventListener('ended', onEnded);
    audio?.addEventListener('ratechange', onRateChange);
    video.addEventListener('error', onError);

    const prepare = async (): Promise<void> => {
      let url: string | null = null;

      // 1. Cache API — the copy downloaded on an earlier play of this track.
      try {
        const cache = await caches.open(MOTION_CACHE);
        const hit = await cache.match(motionCacheRequest(videoId));
        if (hit) {
          const blob = await hit.blob();
          if (cancelled) return;
          revokeActiveObjectUrl();
          activeObjectUrl = URL.createObjectURL(blob);
          url = activeObjectUrl;
        }
      } catch {
        /* Cache API unavailable → fall through to fresh resolution */
      }

      // 2. Fresh: native HLS now, MP4 into the cache in the background.
      if (!url) {
        const urls = await lockScreenMotionUrls(reference);
        if (cancelled || !urls) return; // no artwork / CORS on the web → static
        if (urls.mp4) void cacheMotion(videoId, urls.mp4);
        url = urls.hls ?? urls.mp4;
        if (!url) return;
      }

      if (cancelled) return;
      video.src = url;
      video.load();
      mirror();
    };

    void prepare().catch(() => {});

    return () => {
      cancelled = true;
      audio?.removeEventListener('play', onPlay);
      audio?.removeEventListener('pause', onPause);
      audio?.removeEventListener('ended', onEnded);
      audio?.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('error', onError);
      video.pause();
      video.removeAttribute('src');
      video.load(); // release the media resource (HLS pipeline, blob src)
      revokeActiveObjectUrl();
    };
  }, [enabled, reference, audioRef]);
}
