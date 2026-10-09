/**
 * One-line title that scrolls sideways — Apple Music style — when it is too
 * wide for its box. The box never grows: the text glides through it, holds
 * at each end, and wraps back invisibly.
 *
 * How it works: the single copy is measured against its container, and only
 * when it really overflows is a duplicate rendered and a hold → glide → hold
 * keyframe cycle started. The wrap from the end of the cycle back to the
 * start is invisible because the duplicate sits exactly where the first copy
 * began. Titles that fit keep the normal ellipsis, `prefers-reduced-motion`
 * always keeps the ellipsis, and the animation pauses while off-screen.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';

import { cn } from '../utils/cn';

/** MUI variants call sites still pass, and the tag/classes each one maps to. */
type MarqueeVariant =
  | 'h5'
  | 'h6'
  | 'subtitle1'
  | 'subtitle2'
  | 'body1'
  | 'body2'
  | 'caption'
  | 'button';

const VARIANT_TAG: Record<MarqueeVariant, 'h5' | 'h6' | 'p' | 'span'> = {
  h5: 'h5',
  h6: 'h6',
  subtitle1: 'p',
  subtitle2: 'p',
  body1: 'p',
  body2: 'p',
  caption: 'span',
  button: 'span',
};

const VARIANT_CLASS: Record<MarqueeVariant, string> = {
  h5: 'm-0 text-2xl font-bold',
  h6: 'm-0 text-xl font-bold leading-[1.6] tracking-[-0.01em]',
  subtitle1: 'm-0 text-base font-semibold',
  subtitle2: 'm-0 text-sm font-medium',
  body1: 'm-0 text-base leading-[1.5]',
  body2: 'm-0 text-sm leading-[1.43]',
  caption: 'text-xs leading-[1.4]',
  button: 'text-sm font-semibold',
};

export interface MarqueeTextProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** The single-line string to show (and scroll when it does not fit). */
  text: string;
  /** Glide speed in CSS pixels per second. */
  speed?: number;
  /** MUI `variant` — mapped through the table above (MUI default: body1). */
  variant?: MarqueeVariant;
  /** MUI `sx` — plain CSS values, merged into the inline style. */
  sx?: CSSProperties;
}

/** A shorter cycle would flicker on barely-overflowing titles. */
const MIN_CYCLE_SEC = 4;
/** Share of a cycle spent gliding — the rest is the two holds. */
const GLIDE_SHARE = 0.84;

/**
 * MIGRATION: the `@keyframes` used to live in the component's `sx`;
 * `styles.css` is off limits, so each instance ships them in a `<style>`
 * child — identical rules, so the usual last-one-in-the-document wins.
 */
const MARQUEE_KEYFRAMES = `@keyframes marquee-glide {
  0%, 8% { transform: translateX(0); }
  92%, 100% { transform: translateX(calc(var(--marquee-shift) * -1)); }
}`;

export default function MarqueeText({
  text,
  speed = 45,
  variant = 'body1',
  sx,
  ...typography
}: MarqueeTextProps) {
  const boxRef = useRef<HTMLParagraphElement | null>(null);
  const copyRef = useRef<HTMLSpanElement | null>(null);
  // Width of one copy in px; 0 = fits (or nothing to scroll) → plain ellipsis.
  const [shift, setShift] = useState(0);
  const [onScreen, setOnScreen] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  // The OS can flip this while running — the ellipsis fallback must follow.
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const measure = useCallback(() => {
    const box = boxRef.current;
    const copy = copyRef.current;
    if (!box || !copy) return;
    // getBoundingClientRect, not offsetWidth: the copy may be an inline
    // span, and the running animation only translates (never resizes) it.
    // Keep the exact width (2dp) so the loop seam lands pixel-perfect.
    const width = copy.getBoundingClientRect().width;
    setShift(width > box.clientWidth + 1 ? Math.round(width * 100) / 100 : 0);
  }, []);

  useLayoutEffect(() => {
    measure();
    const box = boxRef.current;
    if (!box) return undefined;
    const resize = new ResizeObserver(measure);
    resize.observe(box);
    // The copy too: a late font swap changes its width without resizing the
    // box, and a stale shift would break the seamless loop.
    if (copyRef.current) resize.observe(copyRef.current);
    // The bundled webfont lands after first paint — remeasure once it does.
    document.fonts.ready.then(measure).catch(() => undefined);
    // Only scroll what the user can actually see.
    const visibility =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            setOnScreen(entries.some((entry) => entry.isIntersecting));
          });
    visibility?.observe(box);
    return () => {
      resize.disconnect();
      visibility?.disconnect();
    };
  }, [measure, text]);

  const scrolling = shift > 0 && !reducedMotion;
  // The glide is GLIDE_SHARE of the cycle, so `shift` px pass by at `speed`.
  const cycle = Math.max(MIN_CYCLE_SEC, shift / speed / GLIDE_SHARE);
  const trackStyle: CSSProperties | undefined = scrolling
    ? ({
        '--marquee-shift': `${shift}px`,
        animation: `marquee-glide ${cycle}s linear 0.9s infinite`,
        animationPlayState: onScreen ? 'running' : 'paused',
      } as CSSProperties)
    : undefined;

  const Tag = VARIANT_TAG[variant] as 'p';

  return (
    <Tag
      ref={boxRef}
      {...typography}
      className={cn(
        VARIANT_CLASS[variant],
        // MUI gave every Typography the interface font — tokens track it here.
        'font-ui overflow-hidden whitespace-nowrap',
        // The glide renders both copies side by side — no ellipsis mid-scroll.
        scrolling ? 'text-clip' : 'text-ellipsis',
        typography.className,
      )}
      style={{ ...typography.style, ...sx }}
    >
      <style>{MARQUEE_KEYFRAMES}</style>
      <span className={scrolling ? 'inline-block' : undefined} style={trackStyle}>
        <span ref={copyRef}>{text}</span>
        {scrolling && (
          <span aria-hidden="true" className="inline-block">
            {text}
          </span>
        )}
      </span>
    </Tag>
  );
}
