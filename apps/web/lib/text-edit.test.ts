import { describe, expect, it } from 'vitest';
import { MAX_FRAME_BYTES } from '@tether/shared/constants';
import { diffText, exceedsEditLimit } from './text-edit';

describe('exceedsEditLimit', () => {
  it('allows ordinary edits and refuses ones the server would reject', () => {
    expect(exceedsEditLimit('hello')).toBe(false);
    expect(exceedsEditLimit('a'.repeat(MAX_FRAME_BYTES))).toBe(true);
  });

  it('counts UTF-8 bytes, not characters', () => {
    const chars = Math.floor(MAX_FRAME_BYTES / 2);
    expect(exceedsEditLimit('a'.repeat(chars))).toBe(false);
    expect(exceedsEditLimit('€'.repeat(chars))).toBe(true); // 3 bytes each
  });
});

describe('diffText', () => {
  const apply = (prev: string, next: string) => {
    const d = diffText(prev, next);
    return prev.slice(0, d.index) + d.insert + prev.slice(d.index + d.deleteCount);
  };

  it('touches only the changed span', () => {
    expect(diffText('hello world', 'hello brave world')).toEqual({ index: 6, deleteCount: 0, insert: 'brave ' });
    expect(diffText('abc', 'ac')).toEqual({ index: 1, deleteCount: 1, insert: '' });
    expect(diffText('same', 'same')).toEqual({ index: 4, deleteCount: 0, insert: '' });
  });

  it('reproduces the target for overlapping and edge cases', () => {
    for (const [a, b] of [['', 'x'], ['x', ''], ['aaa', 'aa'], ['abab', 'ab'], ['ab', 'abab'], ['abc', 'xyz']] as const) {
      expect(apply(a, b)).toBe(b);
    }
  });
});
