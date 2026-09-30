import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  getStorageKey,
  restoreFromStorage,
  persistToStorage,
  clearStorage,
} from './indexedDbStorage.js';

// Minimal in-memory IDB mock for testing native IndexedDB logic in Node
function createMockIndexedDB() {
  const stores = new Map<string, Map<string, unknown>>();

  const factory: Partial<IDBFactory> = {
    open(name: string, _version?: number) {
      const openReq: any = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };

      setTimeout(() => {
        if (!stores.has('snapshots')) {
          stores.set('snapshots', new Map());
        }

        const db: Partial<IDBDatabase> = {
          name,
          version: 1,
          objectStoreNames: {
            contains: (storeName: string) => stores.has(storeName),
          } as unknown as DOMStringList,
          createObjectStore(storeName: string) {
            stores.set(storeName, new Map());
            return {} as IDBObjectStore;
          },
          transaction(_storeNames: any, _mode: any) {
            const store = stores.get('snapshots')!;
            const tx: any = {
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                return {
                  get(key: string) {
                    const req: any = { result: undefined, onsuccess: null, onerror: null };
                    setTimeout(() => {
                      req.result = store.get(key);
                      req.onsuccess?.({ target: req });
                      tx.oncomplete?.();
                    }, 0);
                    return req;
                  },
                  put(value: any) {
                    const req: any = { result: undefined, onsuccess: null, onerror: null };
                    setTimeout(() => {
                      store.set(value.key, value);
                      req.onsuccess?.({ target: req });
                      tx.oncomplete?.();
                    }, 0);
                    return req;
                  },
                  delete(key: string) {
                    const req: any = { result: undefined, onsuccess: null, onerror: null };
                    setTimeout(() => {
                      store.delete(key);
                      req.onsuccess?.({ target: req });
                      tx.oncomplete?.();
                    }, 0);
                    return req;
                  },
                };
              },
            };
            return tx as IDBTransaction;
          },
          close() {},
        };

        openReq.result = db;
        // Trigger onupgradeneeded if first open
        openReq.onupgradeneeded?.({ target: openReq });
        openReq.onsuccess?.({ target: openReq });
      }, 0);

      return openReq as IDBOpenDBRequest;
    },
  };

  return factory as IDBFactory;
}

describe('IndexedDbStorage', () => {
  let mockIdb: IDBFactory;

  beforeEach(() => {
    mockIdb = createMockIndexedDB();
  });

  it('generates epoch-scoped storage keys', () => {
    expect(getStorageKey('room-1', 'epoch-abc')).toBe('collab:room-1:epoch-abc');
  });

  it('returns false when no snapshot exists in storage', async () => {
    const doc = new Y.Doc();
    const restored = await restoreFromStorage(doc, 'room-1', 'epoch-abc', mockIdb);
    expect(restored).toBe(false);
  });

  it('persists and restores a Y.Doc snapshot', async () => {
    const doc1 = new Y.Doc();
    doc1.getText('codemirror').insert(0, 'console.log("hello world");');

    await persistToStorage(doc1, 'room-1', 'epoch-abc', mockIdb);

    const doc2 = new Y.Doc();
    const restored = await restoreFromStorage(doc2, 'room-1', 'epoch-abc', mockIdb);

    expect(restored).toBe(true);
    expect(doc2.getText('codemirror').toString()).toBe('console.log("hello world");');
  });

  it('isolates snapshots across different epochs for the same room', async () => {
    const doc1 = new Y.Doc();
    doc1.getText('codemirror').insert(0, 'epoch 1 code');
    await persistToStorage(doc1, 'room-1', 'epoch-1', mockIdb);

    // Reading with epoch-2 should find nothing
    const doc2 = new Y.Doc();
    const restored = await restoreFromStorage(doc2, 'room-1', 'epoch-2', mockIdb);
    expect(restored).toBe(false);
    expect(doc2.getText('codemirror').toString()).toBe('');
  });

  it('clears storage for a room and epoch', async () => {
    const doc1 = new Y.Doc();
    doc1.getText('codemirror').insert(0, 'to be deleted');
    await persistToStorage(doc1, 'room-1', 'epoch-abc', mockIdb);

    await clearStorage('room-1', 'epoch-abc', mockIdb);

    const doc2 = new Y.Doc();
    const restored = await restoreFromStorage(doc2, 'room-1', 'epoch-abc', mockIdb);
    expect(restored).toBe(false);
  });

  it('handles missing IndexedDB gracefully without throwing', async () => {
    const doc = new Y.Doc();
    // Pass null factory
    const restored = await restoreFromStorage(doc, 'room-1', 'epoch-abc', null as any);
    expect(restored).toBe(false);

    await expect(persistToStorage(doc, 'room-1', 'epoch-abc', null as any)).resolves.not.toThrow();
    await expect(clearStorage('room-1', 'epoch-abc', null as any)).resolves.not.toThrow();
  });
});
