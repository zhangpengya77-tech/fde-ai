import type { DeviceProfile } from '../input/device-profile';
import { fromStoredDeviceProfile, toStoredDeviceProfile } from '../input/device-profile';

/**
 * Minimal key/value contract the profile store needs. IndexedDB and an
 * in-memory fallback both satisfy it, so the persistence logic is unit
 * testable without a browser.
 */
export interface ProfileKeyValueStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** Persisted, validated device-profile storage keyed by device id. */
export interface ProfileStore {
  read(id: string): Promise<DeviceProfile | null>;
  write(profile: DeviceProfile): Promise<void>;
  list(): Promise<DeviceProfile[]>;
  remove(id: string): Promise<void>;
}

const DB_NAME = 'fde-power-inspection';
const STORE_NAME = 'device-profiles';
const PROFILE_KEY_PREFIX = 'fde.device-profile/';

// --- structural IndexedDB surface (so we can wrap the real globals) -----------

interface IdbRequest {
  result: unknown;
  error?: unknown;
  onsuccess: ((this: unknown, ev: unknown) => unknown) | null;
  onerror: ((this: unknown, ev: unknown) => unknown) | null;
}

interface IdbObjectStore {
  get(key: string): IdbRequest;
  put(value: unknown, key: string): IdbRequest;
  delete(key: string): IdbRequest;
  getAllKeys(): IdbRequest;
}

interface IdbTransaction {
  objectStore(name: string): IdbObjectStore;
}

interface IdbDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: { keyPath?: string }): IdbObjectStore;
  transaction(storeNames: string | string[], mode?: 'readonly' | 'readwrite'): IdbTransaction;
  close(): void;
}

interface IdbOpenRequest {
  result: unknown;
  error?: unknown;
  onsuccess: ((this: unknown, ev: unknown) => unknown) | null;
  onerror: ((this: unknown, ev: unknown) => unknown) | null;
  onupgradeneeded: ((this: unknown, ev: unknown) => unknown) | null;
}

export interface IDBFactoryLike {
  open(name: string, version?: number): IdbOpenRequest;
}

function promisify<T>(request: IdbRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(new Error('本地标定数据库请求失败'));
  });
}

/**
 * Thin IndexedDB-backed key/value store. Keys are explicit
 * (`fde.device-profile/<id>`), so no keyPath gymnastics are needed. The whole
 * class is structural on the browser IDB globals and never assumes a brand of
 * controller - it only stores and retrieves plain profile blobs.
 */
export class IndexedDbKeyValueStore implements ProfileKeyValueStore {
  private dbPromise: Promise<IdbDatabase> | null = null;

  constructor(private readonly factory: IDBFactoryLike) {}

  private open(): Promise<IdbDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IdbDatabase>((resolve, reject) => {
      const request = this.factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result as IdbDatabase;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result as IdbDatabase);
      request.onerror = () => reject(new Error('无法打开本地标定数据库'));
    });
    return this.dbPromise;
  }

  private async store(mode: 'readonly' | 'readwrite'): Promise<IdbObjectStore> {
    const db = await this.open();
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  async get(key: string): Promise<unknown> {
    const store = await this.store('readonly');
    return promisify<unknown>(store.get(key));
  }

  async put(key: string, value: unknown): Promise<void> {
    const store = await this.store('readwrite');
    await promisify(store.put(value, key));
  }

  async delete(key: string): Promise<void> {
    const store = await this.store('readwrite');
    await promisify(store.delete(key));
  }

  async keys(): Promise<string[]> {
    const store = await this.store('readonly');
    const result = (await promisify<Array<string | number>>(store.getAllKeys())).map(String);
    return result;
  }
}

/** In-memory fallback used when IndexedDB is unavailable (private browsing, tests). */
export function createMemoryKeyValueStore(): ProfileKeyValueStore {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key) ?? null,
    put: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
    keys: async () => [...map.keys()],
  };
}

export function createProfileStore(kv: ProfileKeyValueStore): ProfileStore {
  return {
    read: async (id) => fromStoredDeviceProfile(await kv.get(PROFILE_KEY_PREFIX + id)),
    write: async (profile) => {
      await kv.put(PROFILE_KEY_PREFIX + profile.id, toStoredDeviceProfile(profile, Date.now()));
    },
    list: async () => {
      const keys = (await kv.keys()).filter((key) => key.startsWith(PROFILE_KEY_PREFIX));
      const profiles = await Promise.all(keys.map(async (key) => fromStoredDeviceProfile(await kv.get(key))));
      return profiles.filter((profile): profile is DeviceProfile => profile !== null);
    },
    remove: async (id) => {
      await kv.delete(PROFILE_KEY_PREFIX + id);
    },
  };
}

/** Picks the real IndexedDB store when the browser exposes one, else memory. */
export function resolveProfileStore(): {
  store: ProfileStore;
  mode: 'indexeddb' | 'memory';
} {
  const factory = typeof indexedDB !== 'undefined' ? (indexedDB as unknown as IDBFactoryLike) : undefined;
  if (factory && typeof factory.open === 'function') {
    return { store: createProfileStore(new IndexedDbKeyValueStore(factory)), mode: 'indexeddb' };
  }
  return { store: createProfileStore(createMemoryKeyValueStore()), mode: 'memory' };
}

export function serializeStoredProfile(profile: DeviceProfile, nowMs: number): string {
  return JSON.stringify(toStoredDeviceProfile(profile, nowMs), null, 2);
}

export function parseStoredProfile(text: string): DeviceProfile | null {
  if (!text) return null;
  try {
    return fromStoredDeviceProfile(JSON.parse(text));
  } catch {
    return null;
  }
}
