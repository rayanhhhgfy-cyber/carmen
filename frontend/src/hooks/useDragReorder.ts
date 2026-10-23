/**
 * Pointer-events drag reordering for a vertical list (mouse + touch).
 *
 * Usage:
 *
 * ```tsx
 * const drag = useDragReorder({
 *   itemCount: items.length,
 *   onMove: (from, to) => reorder(from, to),
 * });
 *
 * return (
 *   <div ref={drag.containerRef}>
 *     {items.map((item, index) => (
 *       <div key={item.id} {...drag.rowProps(index)} className="flex items-center">
 *         <button
 *           type="button"
 *           aria-label={`Reorder ${item.title}`}
 *           {...drag.handleProps(index)}
 *           onClick={(event) => event.stopPropagation()}
 *         >
 *           <GripIcon />
 *         </button>
 *         <Row item={item} />
 *       </div>
 *     ))}
 *   </div>
 * );
 * ```
 *
 * How it works:
 *
 *  - Only the drag *handle* starts a drag (`handleProps(index)` spreads onto
 *    it). Normal list scrolling and row clicks are untouched, because no
 *    listener exists until a handle is pressed.
 *  - On pointer-down the hook captures the pointer on the handle
 *    (`setPointerCapture`), measures every row wrapper — the elements that
 *    carry `data-index` inside the container — and records their tops and
 *    heights for the rest of the gesture.
 *  - On pointer-move it tracks the vertical delta, calls `preventDefault()`
 *    (the listener is registered non-passive, and the handle also carries
 *    `touch-action: none`) so a touch drag never scrolls the page, and
 *    computes the target index from the dragged row's centre passing the
 *    midpoints of the other rows.
 *  - The preview is pure transform state: the dragged row follows the
 *    pointer (`draggingIndex` + `offsetY`, raised z-index and shadow), and
 *    every row between the origin and the target shifts by exactly the
 *    dragged row's height, opening the gap the row would land in.
 *  - On pointer-up it commits once — `onMove(origin, target)` — when the
 *    target differs from the origin, then removes every listener and resets
 *    the preview. Pointer-cancel cleans up without committing.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export interface UseDragReorderOptions {
  /** Number of rows currently rendered — drags clamp inside this range. */
  itemCount: number;
  /** Commit callback, fired once on pointer-up when the row actually moved. */
  onMove: (from: number, to: number) => void;
  /** Disables starting a drag (in-flight saves, read-only lists, …). */
  disabled?: boolean;
}

export interface DragReorderHandleProps {
  'data-drag-handle': true;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  style: CSSProperties;
}

export interface DragReorderRowProps {
  'data-index': number;
  style: CSSProperties;
}

export interface UseDragReorderResult {
  /** Attach to the element that contains every row wrapper. */
  containerRef: { current: HTMLDivElement | null };
  /** Index of the row being dragged, or `null` when idle. */
  draggingIndex: number | null;
  /** Index the dragged row would land on if released now. */
  targetIndex: number | null;
  /** Live vertical pointer delta (px) of the dragged row. */
  offsetY: number;
  isDragging: boolean;
  /** Spread onto the per-row drag handle. */
  handleProps: (index: number) => DragReorderHandleProps;
  /** Spread onto the per-row wrapper (registers `data-index` + preview style). */
  rowProps: (index: number) => DragReorderRowProps;
  /** Just the preview style of `rowProps`, for wrappers that merge props themselves. */
  rowStyle: (index: number) => CSSProperties;
}

interface DragSession {
  pointerId: number;
  origin: number;
  startY: number;
  /** Viewport tops of every row at drag start, by row index. */
  tops: number[];
  /** Heights of every row at drag start, by row index. */
  heights: number[];
  target: number;
  handle: HTMLElement;
  cleanup: () => void;
}

export function useDragReorder({
  itemCount,
  onMove,
  disabled = false,
}: UseDragReorderOptions): UseDragReorderResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  // Always commit through the latest callback: list owners rebuild it when
  // their (not yet reordered) items change, and a drag outlives one render.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;

  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [offsetY, setOffsetY] = useState(0);

  const endSession = useCallback((session: DragSession, commit: boolean) => {
    session.cleanup();
    if (sessionRef.current === session) sessionRef.current = null;
    try {
      if (session.handle.hasPointerCapture(session.pointerId)) {
        session.handle.releasePointerCapture(session.pointerId);
      }
    } catch {
      /* the capture is already gone (pointer-up releases it implicitly) */
    }
    setDraggingIndex(null);
    setTargetIndex(null);
    setOffsetY(0);
    if (commit && session.target !== session.origin) {
      onMoveRef.current(session.origin, session.target);
    }
  }, []);

  // A list that unmounts mid-drag must not leak its window listeners.
  useEffect(
    () => () => {
      if (sessionRef.current) endSession(sessionRef.current, false);
    },
    [endSession],
  );

  const handleProps = useCallback(
    (index: number): DragReorderHandleProps => ({
      'data-drag-handle': true,
      style: { touchAction: 'none', cursor: disabled ? 'default' : 'grab' },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        if (disabled || sessionRef.current) return;
        // Primary button / single touch only — right-clicks keep their menu.
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const container = containerRef.current;
        if (!container || index < 0 || index >= itemCountRef.current) return;

        // Measure the rows once, at drag start: their offsets/heights are
        // the coordinate system for the whole gesture (the preview only
        // transforms rows, it never reflows them).
        const rowEls = Array.from(
          container.querySelectorAll<HTMLElement>('[data-index]'),
        ).sort(
          (a, b) => Number(a.dataset.index ?? 0) - Number(b.dataset.index ?? 0),
        );
        if (!rowEls.some((el) => Number(el.dataset.index) === index)) return;
        const tops: number[] = [];
        const heights: number[] = [];
        rowEls.forEach((el) => {
          const rowIndex = Number(el.dataset.index);
          const rect = el.getBoundingClientRect();
          tops[rowIndex] = rect.top;
          heights[rowIndex] = rect.height;
        });
        if (!heights[index]) return;

        event.preventDefault();
        event.stopPropagation();

        const handle = event.currentTarget;
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
          /* capture is best-effort — window listeners still track the drag */
        }

        const session: DragSession = {
          pointerId: event.pointerId,
          origin: index,
          startY: event.clientY,
          tops,
          heights,
          target: index,
          handle,
          cleanup: () => {},
        };

        const onPointerMove = (moveEvent: PointerEvent) => {
          if (moveEvent.pointerId !== session.pointerId) return;
          // Non-passive listener + preventDefault: a touch drag starting on
          // the handle reorders instead of scrolling the list underneath.
          moveEvent.preventDefault();
          const dy = moveEvent.clientY - session.startY;
          setOffsetY(dy);
          // Target = how many *other* rows' midpoints the dragged row's
          // centre has passed — cumulative offsets, so uneven row heights
          // still land the row where the pointer points.
          const centre =
            (session.tops[session.origin] ?? 0) +
            (session.heights[session.origin] ?? 0) / 2 +
            dy;
          let target = 0;
          for (let row = 0; row < session.heights.length; row += 1) {
            if (row === session.origin) continue;
            const midpoint = (session.tops[row] ?? 0) + (session.heights[row] ?? 0) / 2;
            if (midpoint < centre) target += 1;
          }
          target = Math.max(0, Math.min(itemCountRef.current - 1, target));
          if (target !== session.target) {
            session.target = target;
            setTargetIndex(target);
          }
        };
        const onPointerUp = (upEvent: PointerEvent) => {
          if (upEvent.pointerId !== session.pointerId) return;
          endSession(session, true);
        };
        const onPointerCancel = (cancelEvent: PointerEvent) => {
          if (cancelEvent.pointerId !== session.pointerId) return;
          endSession(session, false);
        };

        session.cleanup = () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('pointercancel', onPointerCancel);
        };
        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);

        sessionRef.current = session;
        setDraggingIndex(index);
        setTargetIndex(index);
        setOffsetY(0);
      },
    }),
    [disabled, endSession],
  );

  const rowStyle = useCallback(
    (index: number): CSSProperties => {
      if (draggingIndex === null) return {};
      const session = sessionRef.current;
      const draggedHeight = session?.heights[draggingIndex] ?? 0;

      if (index === draggingIndex) {
        // The dragged row rides the pointer: no transition (it must track
        // 1:1), raised above its neighbours with a lifted shadow.
        return {
          transform: `translateY(${offsetY}px)`,
          transition: 'none',
          position: 'relative',
          zIndex: 30,
          boxShadow: 'var(--shadow-elev-3)',
        };
      }

      // Rows between origin and target slide by the dragged row's height,
      // opening exactly the gap the dragged row would land in.
      let shift = 0;
      if (targetIndex !== null && draggedHeight > 0) {
        if (draggingIndex < targetIndex && index > draggingIndex && index <= targetIndex) {
          shift = -draggedHeight;
        } else if (
          draggingIndex > targetIndex &&
          index < draggingIndex &&
          index >= targetIndex
        ) {
          shift = draggedHeight;
        }
      }
      return {
        transform: shift ? `translateY(${shift}px)` : undefined,
        transition: 'transform 180ms ease',
        position: 'relative',
        zIndex: 1,
      };
    },
    [draggingIndex, targetIndex, offsetY],
  );

  const rowProps = useCallback(
    (index: number): DragReorderRowProps => ({
      'data-index': index,
      style: rowStyle(index),
    }),
    [rowStyle],
  );

  return {
    containerRef,
    draggingIndex,
    targetIndex,
    offsetY,
    isDragging: draggingIndex !== null,
    handleProps,
    rowProps,
    rowStyle,
  };
}

export default useDragReorder;
