import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { usePlayhead } from '../player/PlayerContext';
import { useTheme } from '../theme/ThemeContext';
import type { LyricLine } from '../types/models';
import { cn } from '../utils/cn';
import { activeLineIndexAt as activeIndexAt } from '../utils/lyrics';

/**
 * Synced lyrics engine — rAF glide + windowed rows, zero renders per tick.
 *
 * **How a tick moves through here.**  A `PlayheadProbe` child subscribes to
 * the playhead context and forwards the seconds into this component, which
 * keeps *everything* in refs: the active line is a binary search over the
 * timestamps, and React state only updates when the **line index actually
 * changes**.  The list therefore never re-renders because time passed — the
 * per-tick cost is one `O(log n)` search.  On a line change, only the rows
 * whose `active`/`past` flags flipped repaint; every other row is a
 * `React.memo` bail-out.
 *
 * **How the view follows.**  The container is a native scroller (wheel,
 * trackpad, touch, scrollbar and keyboard all keep working) whose visible
 * rows are absolutely positioned with `transform: translateY(...)` inside a
 * total-height spacer — no layout, hardware-composited, windowed by
 * `@tanstack/react-virtual` so a 500-line song still paints a dozen nodes.
 * A `requestAnimationFrame` loop eases `scrollTop` toward the centred
 * offset of the active line and **stops itself** once it arrives (or the
 * reader takes over), so idle CPU is exactly zero — no perpetual frame
 * loop, no `timeupdate`-driven DOM writes.
 *
 * **Reader control.**  Any scroll that is not our own write — wheel,
 * touch drag, scrollbar, keyboard — suspends the follow for
 * `RESUME_FOLLOW_MS`; a tapped line seeks the song *and* resumes the
 * follow immediately (the tap is the decision).  Resizes re-centre.
 *
 * The row chrome (accent highlight, scale, past-line dimming, focus ring,
 * tap-keeps-its-hover) is unchanged from the previous react-lrc renderer.
 */

/** How long the reader's own scrolling pauses the follow (ms). */
const RESUME_FOLLOW_MS = 2500;
/** Glide weight per frame — arrives quickly, still eases into place. */
const FOLLOW_EASE = 0.16;
/** Distance from the target (px) at which the glide counts as arrived. */
const FOLLOW_EPSILON = 0.5;
/** Scroll deltas of 2px or less are our own write rounding, not the user. */
const OWN_SCROLL_TOLERANCE = 2;
/** Extra rows rendered above/below the viewport. */
const OVERSCAN = 6;
/** Row height guess before the first measurement (px) — refines itself. */
const ESTIMATED_ROW = 52;

/**
 * The *only* component that subscribes to the playhead, so the engine above
 * stays render-free between lines: it forwards each tick and renders
 * nothing at all.
 */
function PlayheadProbe({ onTick }: { onTick: (seconds: number) => void }) {
  const { currentTime } = usePlayhead();
  useEffect(() => {
    onTick(currentTime);
  }, [currentTime, onTick]);
  return null;
}

interface SyncedLyricsProps {
  /** Timestamped lines of the playing song (never empty — checked by caller). */
  lines: LyricLine[];
  /** Seek the song to a line's timestamp (seconds). */
  onSeek: (seconds: number) => void;
}

/**
 * One lyric line.  Memoised: a playhead tick, a scroll frame or a
 * neighbouring highlight leaves it untouched — it repaints only when its
 * own `active`/`past` flags change, which is the whole point of the engine.
 */
const LyricRow = memo(function LyricRow({
  line,
  active,
  past,
  accentFg,
  onSelect,
}: {
  line: LyricLine;
  active: boolean;
  past: boolean;
  accentFg: string;
  onSelect: (timeMs: number) => void;
}) {
  const handleClick = useCallback(() => onSelect(line.timeMs), [onSelect, line.timeMs]);
  return (
    <button
      type="button"
      aria-current={active || undefined}
      onClick={handleClick}
      className={cn(
        'm-0 block w-full cursor-pointer rounded-[28px] border-none bg-transparent p-[10px]',
        'text-center text-[1.1rem] md:text-[1.15rem] text-body',
        active
          ? 'opacity-100 hover:opacity-100'
          : past
            ? 'opacity-[0.42] hover:opacity-50'
            : 'opacity-70 hover:opacity-[0.85]',
        // a line the reader tapped keeps :hover (and focus) on touch
        // screens — the highlight has to follow the song, not the
        // finger, so only focus-visible still draws a ring
        '[&:focus:not(:focus-visible)]:outline-none focus-visible:outline-offset-2 focus-visible:[outline:2px_solid_var(--lyric-ring)]',
      )}
      style={
        {
          fontFamily: 'inherit',
          // unitless line height: every row keeps the same height even
          // as the active line changes weight — nothing reflows mid-song
          lineHeight: 1.8,
          fontWeight: active ? 700 : 600,
          color: active ? accentFg : undefined,
          // a transform never touches layout, so the highlight cannot
          // shift the lines around it while the song plays
          transform: active ? 'scale(1.05)' : 'scale(1)',
          transformOrigin: 'center',
          transition:
            'color 200ms ease, opacity 200ms ease, transform 240ms cubic-bezier(.2,.8,.2,1)',
          '--lyric-ring': accentFg,
        } as CSSProperties
      }
    >
      {line.text || '♪'}
    </button>
  );
});

export default function SyncedLyrics({ lines, onSeek }: SyncedLyricsProps) {
  const { accentFg } = useTheme();

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /** React mirror of the active line — the only state a tick can change. */
  const [activeIdx, setActiveIdx] = useState(-1);

  // Latest-ref pattern: child effects (the probe) run before this component's
  // own, so the payload must be readable during render, not in an effect.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const activeIdxRef = useRef(-1);
  const lastTickRef = useRef(0);
  const suspendedRef = useRef(false);
  const resumeTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef(0);
  const authoredTopRef = useRef(0);
  /** Publishes the freshest target computation to the stable callbacks. */
  const computeTargetRef = useRef<(idx: number) => number>(() => 0);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ESTIMATED_ROW,
    overscan: OVERSCAN,
    // Room under the last line so it can still travel to the middle of the
    // viewport — the virtual equivalent of the old `pb: 30vh`.
    paddingEnd: (scrollerRef.current?.clientHeight ?? 480) * 0.4,
  });

  /** Centred scroll offset for a line, clamped to what the box can show. */
  const computeTarget = useCallback(
    (idx: number): number => {
      const element = scrollerRef.current;
      if (!element || idx < 0) return 0;
      const info = virtualizer.getOffsetForIndex(idx, 'center');
      const offset = info?.[0] ?? idx * ESTIMATED_ROW;
      const max = Math.max(0, element.scrollHeight - element.clientHeight);
      return Math.min(Math.max(offset, 0), max);
    },
    [virtualizer],
  );
  computeTargetRef.current = computeTarget;

  /** One eased frame; stops itself on arrival, suspension or unmount. */
  const step = useCallback(() => {
    rafRef.current = null;
    const element = scrollerRef.current;
    if (!element || suspendedRef.current) return;
    const delta = targetRef.current - element.scrollTop;
    if (Math.abs(delta) < FOLLOW_EPSILON) return;
    const max = Math.max(0, element.scrollHeight - element.clientHeight);
    const next = Math.min(element.scrollTop + delta * FOLLOW_EASE, max);
    // A target past the box's end (a near-final line that cannot reach the
    // centre) settles here — the browser would clamp the write and the
    // mismatch would spin the loop forever.
    if (Math.abs(next - element.scrollTop) < FOLLOW_EPSILON) return;
    authoredTopRef.current = next;
    element.scrollTop = next;
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const startGlide = useCallback(() => {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(step);
  }, [step]);

  const glideToActive = useCallback(() => {
    targetRef.current = computeTargetRef.current(activeIdxRef.current);
    startGlide();
  }, [startGlide]);

  /** Reader took over: stop following, come back after the grace period. */
  const suspend = useCallback(() => {
    suspendedRef.current = true;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      suspendedRef.current = false;
      glideToActive();
    }, RESUME_FOLLOW_MS);
  }, [glideToActive]);

  /** The single funnel: a playhead tick or a payload change lands here. */
  const syncTo = useCallback(
    (timeMs: number) => {
      const idx = activeIndexAt(linesRef.current, Math.max(0, timeMs));
      if (idx === activeIdxRef.current) {
        // Index unchanged — but a glide may have been cancelled out from
        // under us (StrictMode's second mount passes run after the cleanup).
        // If no frame is pending and the view is not on target, re-arm.
        const element = scrollerRef.current;
        if (
          !suspendedRef.current &&
          rafRef.current === null &&
          element &&
          Math.abs(targetRef.current - element.scrollTop) > FOLLOW_EPSILON
        ) {
          glideToActive();
        }
        return;
      }
      activeIdxRef.current = idx;
      setActiveIdx(idx); // the only render a line change costs
      if (!suspendedRef.current) glideToActive();
    },
    [glideToActive],
  );

  const handleTick = useCallback(
    (seconds: number) => {
      lastTickRef.current = seconds;
      syncTo(seconds * 1000);
    },
    [syncTo],
  );

  // Lines can arrive *after* the playhead stood still (a late lyrics fetch,
  // a track switched while paused) — re-derive the active line whenever the
  // payload changes, not only when time moves.
  useEffect(() => {
    syncTo(lastTickRef.current * 1000);
  }, [lines, syncTo]);

  // Detect scrolls we did not author (wheel, drag, keyboard, momentum) and
  // park the follow for the grace period.
  const handleScroll = useCallback(() => {
    const element = scrollerRef.current;
    if (!element) return;
    if (Math.abs(element.scrollTop - authoredTopRef.current) <= OWN_SCROLL_TOLERANCE) return;
    suspend();
  }, [suspend]);

  // Wheel/touch also suspend when they move nothing (a nudge at the very
  // top) — the intent to scroll is the same either way.
  const handleManualScroll = useCallback(() => suspend(), [suspend]);

  const handleSelect = useCallback(
    (timeMs: number) => {
      // The tap *is* the decision: cancel the suspension, seek, and glide to
      // the line right now — even when it is the line already playing.
      suspendedRef.current = false;
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      onSeek(timeMs / 1000);
      syncTo(timeMs); // index may not even change (tapping the current line)
      glideToActive();
    },
    [onSeek, syncTo, glideToActive],
  );

  // Listener + lifetime wiring.
  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return undefined;
    element.addEventListener('scroll', handleScroll, { passive: true });
    element.addEventListener('wheel', handleManualScroll, { passive: true });
    element.addEventListener('touchmove', handleManualScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', handleScroll);
      element.removeEventListener('wheel', handleManualScroll);
      element.removeEventListener('touchmove', handleManualScroll);
    };
  }, [handleScroll, handleManualScroll]);

  // A taller/shorter box moves the centre line — re-target on resize.
  useEffect(() => {
    const element = scrollerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (!suspendedRef.current) glideToActive();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [glideToActive]);

  useEffect(
    () => () => {
      // Null the refs after cancelling: `rafRef non-null` must mean "a frame
      // is pending", or `startGlide`'s guard refuses to schedule ever again.
      // (StrictMode's mount/unmount pass runs this cleanup while the same
      // instance is reused — a stale id here used to kill the follow for
      // good, which is why opening lyrics mid-song never scrolled.)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    },
    [],
  );

  const rows = virtualizer.getVirtualItems();

  return (
    <>
      <PlayheadProbe onTick={handleTick} />
      {/* `translateZ(0)` + will-change promote the scroller to its own
          compositor layer, so the eased scrollTop and the transform-positioned
          rows never wait on style/layout work (spec: hardware acceleration). */}
      <div
        ref={scrollerRef}
        className="relative min-h-0 flex-1 overflow-y-auto px-2 py-2 will-change-transform sm:px-3 [transform:translateZ(0)]"
        style={{
          // room below the last line so it can still travel to the middle
          paddingBottom: '30vh',
          // the head and tail of the viewport fade instead of cutting off
          maskImage:
            'linear-gradient(to bottom, transparent 0, black 32px, black calc(100% - 96px), transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0, black 32px, black calc(100% - 96px), transparent 100%)',
        }}
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {rows.map((row) => {
            const line = lines[row.index];
            if (!line) return null;
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full will-change-transform"
                style={{
                  // windowed rows are positioned on the compositor only
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <LyricRow
                  line={line}
                  active={row.index === activeIdx}
                  past={row.index < activeIdx}
                  accentFg={accentFg}
                  onSelect={handleSelect}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
