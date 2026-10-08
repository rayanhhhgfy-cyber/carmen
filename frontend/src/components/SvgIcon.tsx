import type { CSSProperties, ReactNode, SVGProps } from 'react';

/**
 * Local `SvgIcon` — the MUI element the icon set used to extend, rebuilt
 * on plain SVG so the icon library (and every `sx`/`fontSize`/`color` prop
 * at its call sites) survives the Tailwind migration unchanged.
 *
 * Reproduces the MUI contract the app relies on:
 *
 *  - `width/height: 1em` with the three named `fontSize` steps
 *    (small 20px, medium 24px — the default — large 34px);
 *  - `color` roles mapped onto the theme's CSS variables
 *    (`primary` is the live accent, so it still follows Settings and the
 *    adaptive per-track colour);
 *  - `sx.fontSize` in **pixels** and `sx.color` as a theme token
 *    (`text.secondary`, `action.active`, …) or any CSS colour;
 *  - `fill: currentColor`, `display: inline-block`, `user-select: none`,
 *    `focusable="false"` and `aria-hidden` when the icon is decorative —
 *    exactly what MUI painted.
 *
 * The `sx` surface is intentionally narrow: it is typed, so the compiler
 * flags any call site that relied on a part of the MUI system this element
 * never needed.
 */

/** The MUI `fontSize` ladder, in rem. */
const FONT_SIZES = {
  small: '1.25rem', // 20px
  medium: '1.5rem', // 24px
  large: '2.125rem', // 34px
} as const;

/** Theme tokens an icon `sx` may name, resolved onto the CSS variables. */
const SX_COLORS: Record<string, string> = {
  inherit: 'inherit',
  'text.primary': 'var(--app-text)',
  'text.secondary': 'var(--app-text-secondary)',
  'text.disabled': 'var(--app-text-disabled)',
  'action.active': 'var(--app-action-active)',
  'action.disabled': 'var(--app-text-disabled)',
  'primary.main': 'var(--app-accent)',
};

/** The `color` prop's MUI roles, resolved onto the CSS variables. */
const ROLE_COLORS: Record<string, string | undefined> = {
  inherit: undefined, // let the cascade decide, like MUI's `color: inherit`
  action: 'var(--app-action-active)',
  disabled: 'var(--app-text-disabled)',
  primary: 'var(--app-accent)',
  success: 'var(--app-success)',
};

/** The only `sx` keys icons actually use — everything else is a type error. */
export interface IconSx {
  fontSize?: number;
  color?: string;
  opacity?: number;
  flexShrink?: number;
  display?: string;
  transform?: string;
  transition?: string;
  /** MUI spacing — number → px at the 8px grid (0.75 → 6px, 1.5 → 12px). */
  mr?: number;
  ml?: number;
  mt?: number;
  mb?: number;
}

export interface SvgIconProps extends Omit<SVGProps<SVGSVGElement>, 'color' | 'sx'> {
  /** Optional in the MUI contract too — `ComponentType<SvgIconProps>` slots render bare. */
  children?: ReactNode;
  /** MUI colour roles the app uses (`inherit` is the default). */
  color?: 'inherit' | 'action' | 'disabled' | 'primary' | 'success';
  /** MUI named steps; defaults to `medium` (24px), scaled by `width/height: 1em`. */
  fontSize?: 'inherit' | 'small' | 'medium' | 'large';
  /** Pixel font size and/or a token colour — the MUI `sx` subset icons need. */
  sx?: IconSx;
  /** Accessible name (MUI's `title`/`titleAccess`); when present the icon is no longer `aria-hidden`. */
  title?: string;
  /** MUI alias of `title`, kept so call sites read exactly as before. */
  titleAccess?: string;
}

export default function SvgIcon({
  children,
  color = 'inherit',
  fontSize = 'medium',
  sx,
  title,
  titleAccess,
  viewBox = '0 0 24 24',
  className,
  style,
  ...rest
}: SvgIconProps) {
  const accessibleName = title ?? titleAccess;
  const size =
    fontSize === 'inherit' ? 'inherit' : FONT_SIZES[fontSize as 'small' | 'medium' | 'large'];

  const resolvedColor =
    (sx?.color && (SX_COLORS[sx.color] ?? sx.color)) || ROLE_COLORS[color];

  // Only sx-derived values live inline (they must win); the MUI root
  // defaults are the `.svg-icon` class in styles.css, overridable by
  // utilities like `hidden sm:flex`.
  const iconStyle: CSSProperties = {
    fontSize: size,
    ...(resolvedColor ? { color: resolvedColor } : null),
    ...(sx?.fontSize !== undefined ? { fontSize: `${sx.fontSize}px` } : null),
    ...(sx?.flexShrink !== undefined ? { flexShrink: sx.flexShrink } : null),
    ...(sx?.opacity !== undefined ? { opacity: sx.opacity } : null),
    ...(sx?.display !== undefined ? { display: sx.display } : null),
    ...(sx?.transform !== undefined ? { transform: sx.transform } : null),
    ...(sx?.transition !== undefined ? { transition: sx.transition } : null),
    ...(sx?.mr !== undefined ? { marginRight: `${sx.mr * 8}px` } : null),
    ...(sx?.ml !== undefined ? { marginLeft: `${sx.ml * 8}px` } : null),
    ...(sx?.mt !== undefined ? { marginTop: `${sx.mt * 8}px` } : null),
    ...(sx?.mb !== undefined ? { marginBottom: `${sx.mb * 8}px` } : null),
    ...style,
  };

  return (
    <svg
      viewBox={viewBox}
      focusable="false"
      aria-hidden={accessibleName ? undefined : true}
      {...rest}
      className={className ? `svg-icon ${className}` : 'svg-icon'}
      style={iconStyle}
    >
      {accessibleName ? <title>{accessibleName}</title> : null}
      {children}
    </svg>
  );
}
