/**
 * Pure list reordering — the one move primitive behind every drag-reorder
 * surface (queue, playlist detail).
 *
 * `moveItem` never mutates its input and always returns a new array, so it
 * drops straight into a React state updater. Out-of-range indices are
 * clamped to the nearest edge instead of throwing: a drag gesture reports
 * positions against a list that may have changed mid-gesture, and the
 * forgiving answer is "as far as it can go", not a crash. A no-op move
 * (same index, empty list, single item) returns a same-order copy.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items];
  if (result.length < 2) return result;

  const clamp = (index: number): number => {
    if (!Number.isFinite(index)) return 0;
    return Math.min(Math.max(Math.trunc(index), 0), result.length - 1);
  };

  const start = clamp(from);
  const target = clamp(to);
  if (start === target) return result;

  const [moved] = result.splice(start, 1);
  result.splice(target, 0, moved as T);
  return result;
}
