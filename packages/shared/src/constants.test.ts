import { describe, it, expect } from 'vitest';
import {
  PERSIST_MAX_QUEUED_PER_ROOM,
  PERSIST_MAX_BUFFERED_UPDATES,
} from './constants.js';

describe('Shared Persistence Constants', () => {
  it('exports bounded persistence buffer limits', () => {
    expect(PERSIST_MAX_QUEUED_PER_ROOM).toBe(64);
    expect(PERSIST_MAX_BUFFERED_UPDATES).toBe(10_000);
  });
});
