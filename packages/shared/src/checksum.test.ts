import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { areStateVectorsEqual, hashString } from './checksum.js';

describe('Checksum & State Vector Helpers', () => {
  describe('areStateVectorsEqual', () => {
    it('returns true for identical documents', () => {
      const doc = new Y.Doc();
      const text = doc.getText('codemirror');
      text.insert(0, 'Hello, world!');

      const sv1 = Y.encodeStateVector(doc);
      const sv2 = Y.encodeStateVector(doc);

      expect(areStateVectorsEqual(sv1, sv2)).toBe(true);
    });

    it('returns true when state vectors have the same entries regardless of internal order', () => {
      // Simulate two docs that received updates from client 10 and client 20 in different order
      const doc1 = new Y.Doc();
      doc1.clientID = 10;
      const doc2 = new Y.Doc();
      doc2.clientID = 20;

      doc1.getText('t').insert(0, 'A');
      doc2.getText('t').insert(0, 'B');

      // Sync doc1 with doc2 and vice versa
      Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

      const sv1 = Y.encodeStateVector(doc1);
      const sv2 = Y.encodeStateVector(doc2);

      expect(areStateVectorsEqual(sv1, sv2)).toBe(true);
    });

    it('returns false for diverging documents', () => {
      const doc1 = new Y.Doc();
      doc1.clientID = 1;
      const doc2 = new Y.Doc();
      doc2.clientID = 2;

      doc1.getText('t').insert(0, 'Hello');
      doc2.getText('t').insert(0, 'World');

      const sv1 = Y.encodeStateVector(doc1);
      const sv2 = Y.encodeStateVector(doc2);

      expect(areStateVectorsEqual(sv1, sv2)).toBe(false);
    });
  });

  describe('hashString', () => {
    it('produces deterministic 8-character hex output', () => {
      const h1 = hashString('const x = 42;');
      const h2 = hashString('const x = 42;');
      const h3 = hashString('const x = 43;');

      expect(h1).toHaveLength(8);
      expect(h1).toBe(h2);
      expect(h1).not.toBe(h3);
    });
  });
});
