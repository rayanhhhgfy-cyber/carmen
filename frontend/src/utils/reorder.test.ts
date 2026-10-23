/**
 * Unit tests for the pure reorder primitive behind drag reorder.
 */
import { describe, expect, it } from 'vitest';

import { moveItem } from './reorder';

describe('moveItem', () => {
  it('moves an item forward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item backward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves to the very edges', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('clamps out-of-range indices instead of throwing', () => {
    expect(moveItem(['a', 'b', 'c'], -5, 99)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 99, -5)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op (same-order copy) for equal indices', () => {
    const items = ['a', 'b', 'c'];
    const result = moveItem(items, 1, 1);
    expect(result).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(items);
  });

  it('handles empty and single-item lists', () => {
    expect(moveItem([], 0, 0)).toEqual([]);
    expect(moveItem(['a'], 0, 5)).toEqual(['a']);
  });

  it('never mutates its input', () => {
    const items = ['a', 'b', 'c'];
    moveItem(items, 0, 2);
    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('works on object lists (queue / playlist rows)', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(moveItem(items, 2, 0).map((item) => item.id)).toEqual([3, 1, 2]);
  });
});
