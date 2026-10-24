/**
 * Overlay primitives — MUI's portal-based widgets, rebuilt on framer +
 * `createPortal`.
 *
 *  - `Menu` / `MenuItem` / `ListItemIcon`: positioned from the anchor
 *    rectangle, flipped above when it would fall off-screen, closed by
 *    outside pointer-down, Escape, or any item click (MUI Menu parity).
 *  - `Dialog` set: dimmed backdrop, centred panel, Escape/backdrop close,
 *    body scroll locked while open.
 *  - `Snackbar` / `Alert`: timed toast in the corner the call site asks
 *    for, with MUI's filled severity colours.
 *
 * Enter/exit motion is short (120–200ms) — enough to read as a layer
 * appearing, never in the way.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  createContext,
  useContext,
  type HTMLAttributes,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

import { cn } from '../../utils/cn';

/* ── Layering ─────────────────────────────────────────────────────────── */

/**
 * Stack of open overlay layers (dialogs, menus), newest last.
 *
 * Two independent rules keep stacked overlays from closing each other:
 *
 *  - **Escape closes only the topmost layer** — a menu opened inside the
 *    player sheet must close itself, not the sheet behind it;
 *  - **a pointer-down inside another layer's portal belongs to that layer**
 *    — the `data-overlay-root` attribute marks those portals, and the
 *    dialog's backdrop-close skips a press that landed in one (the menu
 *    items are portalled to `body`, *outside* the dialog panel, so without
 *    this rule tapping "Download" would both run the action and dismiss the
 *    sheet).
 */
const openLayers: symbol[] = [];

function isTopLayer(layer: symbol): boolean {
  return openLayers[openLayers.length - 1] === layer;
}

function pushLayer(layer: symbol): void {
  openLayers.push(layer);
}

function dropLayer(layer: symbol): void {
  const index = openLayers.lastIndexOf(layer);
  if (index >= 0) openLayers.splice(index, 1);
}

/* ── Menu ─────────────────────────────────────────────────────────────── */

const MenuContext = createContext<(() => void) | null>(null);

interface MenuProps {
  open: boolean;
  /** MUI's anchor — the popover drops below this element's box. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

/** MUI `Menu` — anchored popover. */
export function Menu({ open, anchorEl, onClose, children, className, ...rest }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const layer = useRef(Symbol('menu'));
  const [pos, setPos] = useState<CSSProperties>({ top: -9999, left: -9999 });

  // Position from the anchor's box after mount (so the panel's own size is
  // known), flipping above / to the left when the preferred corner overflows.
  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const el = ref.current;
    const width = el?.offsetWidth ?? 0;
    const height = el?.offsetHeight ?? 0;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    setPos({ top, left });
  }, [open, anchorEl]);

  // Outside click + Escape close the menu (MUI Modal behaviour). Escape
  // only fires for the topmost layer, so a menu over a dialog closes the
  // menu alone.
  useEffect(() => {
    if (!open) return undefined;
    pushLayer(layer.current);
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopLayer(layer.current)) onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      dropLayer(layer.current);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <MenuContext.Provider value={onClose}>
          <motion.div
            ref={ref}
            role="menu"
            data-overlay-root=""
            {...rest}
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            style={pos}
            className={cn(
              'fixed z-[1300] min-w-44 max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-glass',
              className,
            )}
          >
            {children}
          </motion.div>
        </MenuContext.Provider>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

interface MenuItemProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onClick'> {
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  selected?: boolean;
  dense?: boolean;
  children?: ReactNode;
}

/** MUI `MenuItem` — closes the menu after its own handler runs. */
export function MenuItem({
  onClick,
  disabled,
  selected,
  dense,
  className,
  children,
  ...rest
}: MenuItemProps) {
  const close = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      {...rest}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) close?.();
      }}
      className={cn(
        'flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-body',
        dense ? 'py-1' : 'py-1.5',
        'transition-colors duration-100 hover:bg-hover',
        'focus-visible:outline-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-40',
        selected && 'bg-hover',
        className,
      )}
    >
      {children}
    </button>
  );
}

interface ListItemIconProps extends HTMLAttributes<HTMLSpanElement> {
  /** MUI compat subset — `minWidth`/`color` were the only keys used. */
  sx?: { minWidth?: number; color?: string };
  children?: ReactNode;
}

/** MUI `ListItemIcon` — leading icon slot in menus and nav rows. */
export function ListItemIcon({ sx, className, children, style, ...rest }: ListItemIconProps) {
  return (
    <span
      {...rest}
      style={{
        ...(sx?.minWidth !== undefined ? { minWidth: sx.minWidth } : null),
        ...(sx?.color !== undefined ? { color: sx.color } : null),
        ...style,
      }}
      className={cn('inline-flex min-w-[56px] shrink-0 items-center justify-center max-sm:min-w-[40px]', className)}
    >
      {children}
    </span>
  );
}

/* ── Dialog ───────────────────────────────────────────────────────────── */

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  /** MUI steps: `xs` = 448px (the only width call sites use). */
  maxWidth?: 'xs' | 'sm' | 'md';
  fullWidth?: boolean;
  /**
   * Enter from / leave **through the bottom edge** instead of the shared
   * fade — a bottom sheet has to close downward, the way it was dragged
   * out (the phone player sheet passes this; desktop keeps the fade).
   */
  slideFromBottom?: boolean;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}

/** Shared sheet curve — a slightly over-damped ease-out, no bounce. */
const SHEET_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** MUI `Dialog` — backdrop + centred panel; locks body scroll while open. */
export function Dialog({
  open,
  onClose,
  maxWidth = 'sm',
  fullWidth,
  slideFromBottom,
  children,
  className,
  ...rest
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const layer = useRef(Symbol('dialog'));

  // MUI Modal parity: Escape closes, the backdrop closes, the page behind
  // stops scrolling.
  useEffect(() => {
    if (!open) return undefined;
    pushLayer(layer.current);
    const onKey = (event: KeyboardEvent) => {
      // A menu layered on top owns Escape; the dialog stays put.
      if (event.key === 'Escape' && isTopLayer(layer.current)) onClose?.();
    };
    const onPointer = (event: PointerEvent) => {
      if (!ref.current) return;
      const target = event.target as Node | null;
      if (target && ref.current.contains(target)) return;
      // A press inside *another* overlay's portal (a menu opened from this
      // dialog, a dialog stacked above) belongs to that layer — closing
      // from underneath it would swallow the action that was just tapped.
      const outer = target instanceof Element ? target.closest('[data-overlay-root]') : null;
      if (outer && outer !== ref.current.closest('[data-overlay-root]')) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dropLayer(layer.current);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          data-overlay-root=""
          className="fixed inset-0 z-[1300] flex items-center justify-center pb-[max(1rem,var(--sab))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,var(--sat))]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          // Sliding mode keeps the container opaque: the backdrop fades on
          // its own below, and a fading parent would drag the descending
          // panel down with it. AnimatePresence still waits for both.
          exit={
            slideFromBottom
              ? { opacity: 1, transition: { duration: 0 } }
              : { opacity: 0, transition: { duration: 0.12 } }
          }
          transition={{ duration: 0.16 }}
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/50"
            onClick={() => onClose?.()}
            exit={
              slideFromBottom ? { opacity: 0, transition: { duration: 0.28 } } : undefined
            }
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            {...rest}
            initial={slideFromBottom ? { opacity: 0, y: '100%' } : { opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              slideFromBottom
                ? { y: '100%', transition: { duration: 0.28, ease: SHEET_EASE } }
                : { opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.12 } }
            }
            transition={
              slideFromBottom
                ? { duration: 0.3, ease: SHEET_EASE }
                : { duration: 0.18, ease: 'easeOut' }
            }
            className={cn(
              'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-card bg-surface shadow-glass',
              maxWidth === 'xs' && 'max-w-[448px]',
              maxWidth === 'sm' && 'max-w-[600px]',
              maxWidth === 'md' && 'max-w-[900px]',
              fullWidth && 'max-w-none',
              className,
            )}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** MUI `DialogTitle` — heading row. */
export function DialogTitle({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn('px-4 pb-2 pt-5 text-base font-bold leading-6 sm:px-6', className)}>
      {children}
    </div>
  );
}

/** MUI `DialogContent` — scrollable body. */
export function DialogContent({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-6', className)}>
      {children}
    </div>
  );
}

/** MUI `DialogActions` — button row (end-aligned, `!`-overrideable). */
export function DialogActions({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn('flex flex-wrap items-center gap-2 px-4 pb-4 pt-2 justify-end sm:px-6', className)}>
      {children}
    </div>
  );
}

/* ── Snackbar / Alert ─────────────────────────────────────────────────── */

interface SnackbarProps {
  open: boolean;
  autoHideDuration?: number;
  /** MUI signature — reason is `timeout` | `clickaway`; `undefined` when the user dismisses. */
  onClose?: (event?: unknown, reason?: string) => void;
  anchorOrigin?: { vertical: 'top' | 'bottom'; horizontal: 'left' | 'center' | 'right' };
  children: ReactNode;
}

/** MUI `Snackbar` — toast slot, auto-hides, framer in/out. */
export function Snackbar({ open, autoHideDuration = 4000, onClose, anchorOrigin, children }: SnackbarProps) {
  useEffect(() => {
    if (!open || !autoHideDuration) return undefined;
    const timer = setTimeout(() => onClose?.(undefined, 'timeout'), autoHideDuration);
    return () => clearTimeout(timer);
  }, [open, autoHideDuration, onClose]);

  if (typeof document === 'undefined') return null;

  const vertical = anchorOrigin?.vertical ?? 'bottom';
  const horizontal = anchorOrigin?.horizontal ?? 'center';
  const placement = cn(
    'absolute z-[1400] px-4',
    // top toasts clear the status bar (0px inset on desktop / non-cover
    // layouts, so this only ever bites on an edge-to-edge phone).
    vertical === 'top' ? 'top-[max(1rem,var(--sat))]' : 'bottom-[max(1rem,var(--sab))]',
    horizontal === 'left'
      ? 'left-0'
      : horizontal === 'right'
        ? 'right-0'
        : 'left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2',
  );

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className={cn('pointer-events-none fixed inset-0 z-[1400]')}
          aria-hidden
        >
          <motion.div
            className={placement}
            initial={{ opacity: 0, y: vertical === 'top' ? -16 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: vertical === 'top' ? -16 : 16, transition: { duration: 0.15 } }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="pointer-events-auto">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  severity?: 'info' | 'success' | 'warning' | 'error';
  /** Filled is the only variant the app used. */
  variant?: 'filled';
  /** Click-to-dismiss affordance MUI's filled alerts showed. */
  onClose?: () => void;
  children: ReactNode;
}

const SEVERITY_BG: Record<string, string> = {
  info: 'bg-[#0288d1] dark:bg-[#03a9f4]',
  success: 'bg-success',
  warning: 'bg-[#ed6c02] dark:bg-[#ff9800]',
  error: 'bg-error',
};

/** MUI `Alert` (filled) — coloured toast/message banner. */
export function Alert({ severity = 'info', onClose, className, children, ...rest }: AlertProps) {
  return (
    <div
      role="alert"
      {...rest}
      className={cn(
        'flex items-start gap-2 rounded-card px-4 py-2 text-sm font-medium text-white shadow-glass',
        SEVERITY_BG[severity],
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onClose ? (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mr-1 shrink-0 rounded p-1 text-white/80 transition hover:bg-white/15 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
