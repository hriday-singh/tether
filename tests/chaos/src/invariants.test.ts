import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  assertI1Convergence,
  assertI2NoLoss,
  assertI3NoDuplication,
  assertI4ThrottleBound,
  extractTagsFromText,
} from './invariants.js';

describe('Chaos Invariants Checkers', () => {
  describe('I1: Convergence', () => {
    it('passes when all client texts match server text', () => {
      const serverDoc = new Y.Doc();
      serverDoc.getText('codemirror').insert(0, 'hello world');

      const client1Doc = new Y.Doc();
      client1Doc.getText('codemirror').insert(0, 'hello world');

      const client2Doc = new Y.Doc();
      client2Doc.getText('codemirror').insert(0, 'hello world');

      expect(() =>
        assertI1Convergence(serverDoc, [client1Doc, client2Doc])
      ).not.toThrow();
    });

    it('throws when a client text differs from server text', () => {
      const serverDoc = new Y.Doc();
      serverDoc.getText('codemirror').insert(0, 'hello world');

      const client1Doc = new Y.Doc();
      client1Doc.getText('codemirror').insert(0, 'hello divergence');

      expect(() =>
        assertI1Convergence(serverDoc, [client1Doc])
      ).toThrow(/Invariant I1 Violation/);
    });
  });

  describe('I2: No Loss & I3: No Duplication', () => {
    it('extractTagsFromText correctly extracts ⟦c...#...⟧ tags', () => {
      const text = 'prefix⟦c1#1⟧middle⟦c2#42⟧suffix';
      const tags = extractTagsFromText(text);
      expect(tags).toEqual(['⟦c1#1⟧', '⟦c2#42⟧']);
    });

    it('passes I2 when all active tags exist in text', () => {
      const text = 'foo⟦c1#1⟧bar⟦c2#2⟧baz';
      const activeTags = new Set(['⟦c1#1⟧', '⟦c2#2⟧']);
      expect(() => assertI2NoLoss(text, activeTags)).not.toThrow();
    });

    it('throws I2 when an active tag is missing', () => {
      const text = 'foo⟦c1#1⟧baz';
      const activeTags = new Set(['⟦c1#1⟧', '⟦c2#2⟧']);
      expect(() => assertI2NoLoss(text, activeTags)).toThrow(/Invariant I2 Violation/);
    });

    it('passes I3 when no tag appears more than once', () => {
      const text = 'foo⟦c1#1⟧bar⟦c2#2⟧baz';
      expect(() => assertI3NoDuplication(text)).not.toThrow();
    });

    it('throws I3 when a tag is duplicated', () => {
      const text = 'foo⟦c1#1⟧bar⟦c1#1⟧baz';
      expect(() => assertI3NoDuplication(text)).toThrow(/Invariant I3 Violation/);
    });
  });

  describe('I4: Throttle Bound', () => {
    it('passes when no sliding 1000ms window has > 5 frames from one source', () => {
      // 5 frames over 1000ms
      const timestamps = [100, 300, 500, 700, 900, 1200, 1400];
      expect(() =>
        assertI4ThrottleBound(new Map([['source1', timestamps]]))
      ).not.toThrow();
    });

    it('throws when more than 5 frames occur in any 1000ms window', () => {
      // 6 frames within 500ms
      const timestamps = [100, 150, 200, 250, 300, 350];
      expect(() =>
        assertI4ThrottleBound(new Map([['source1', timestamps]]))
      ).toThrow(/Invariant I4 Violation/);
    });
  });
});
