import * as Y from 'yjs';

const DB_NAME = 'tether_storage_v1';
const STORE_NAME = 'snapshots';

export interface StorageIDBFactory {
  open(name: string, version?: number): any;
}

export interface StorageIDBDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: any): any;
  transaction(storeNames: any, mode?: any): any;
  close?(): void;
}

export interface StoredSnapshot {
  key: string;
  snapshot: Uint8Array;
  savedAt: number;
}

export function getStorageKey(roomId: string, roomEpoch: string): string {
  return `collab:${roomId}:${roomEpoch}`;
}

export function getIndexedDBFactory(customFactory?: StorageIDBFactory): StorageIDBFactory | null {
  if (customFactory !== undefined) {
    return customFactory;
  }
  if (typeof globalThis !== 'undefined' && 'indexedDB' in globalThis) {
    return (globalThis as any).indexedDB as StorageIDBFactory;
  }
  return null;
}

export function openStorageDb(factory?: StorageIDBFactory): Promise<StorageIDBDatabase | null> {
  const idb = getIndexedDBFactory(factory);
  if (!idb) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = idb.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export async function restoreFromStorage(
  doc: Y.Doc,
  roomId: string,
  roomEpoch: string,
  factory?: StorageIDBFactory
): Promise<boolean> {
  const db = await openStorageDb(factory);
  if (!db) {
    return false;
  }

  const key = getStorageKey(roomId, roomEpoch);

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        const result = req.result as StoredSnapshot | undefined;
        if (result && result.snapshot && result.snapshot.byteLength > 0) {
          try {
            Y.applyUpdate(doc, new Uint8Array(result.snapshot), 'storage');
            resolve(true);
          } catch {
            resolve(false);
          }
        } else {
          resolve(false);
        }
      };

      req.onerror = () => {
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

export async function persistToStorage(
  doc: Y.Doc,
  roomId: string,
  roomEpoch: string,
  factory?: StorageIDBFactory
): Promise<void> {
  const db = await openStorageDb(factory);
  if (!db) {
    return;
  }

  const key = getStorageKey(roomId, roomEpoch);
  const snapshot = Y.encodeStateAsUpdate(doc);

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record: StoredSnapshot = {
        key,
        snapshot,
        savedAt: Date.now(),
      };
      const req = store.put(record);

      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearStorage(
  roomId: string,
  roomEpoch: string,
  factory?: StorageIDBFactory
): Promise<void> {
  const db = await openStorageDb(factory);
  if (!db) {
    return;
  }

  const key = getStorageKey(roomId, roomEpoch);

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);

      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
