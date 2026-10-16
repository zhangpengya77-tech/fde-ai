import {
  createMemoryKeyValueStore,
  IndexedDbKeyValueStore,
  type IDBFactoryLike,
  type ProfileKeyValueStore,
} from '../ui/profile-store';
import type { InspectionCaptureRecord } from '../inspection/types';

const KEY_PREFIX = 'fde.inspection-capture/';

/**
 * Captured-evidence storage for P1-5. It reuses the same raw key/value layer as
 * the device-profile store (IndexedDB with an in-memory fallback) under its own
 * key prefix, so the data structure is persisted now and P1-7 only has to read
 * and present it.
 */
export interface InspectionCaptureStore {
  save(record: InspectionCaptureRecord): Promise<void>;
  list(): Promise<InspectionCaptureRecord[]>;
}

export function createInspectionCaptureStore(kv: ProfileKeyValueStore): InspectionCaptureStore {
  return {
    async save(record: InspectionCaptureRecord): Promise<void> {
      await kv.put(KEY_PREFIX + record.id, record);
    },
    async list(): Promise<InspectionCaptureRecord[]> {
      const keys = (await kv.keys()).filter((key) => key.startsWith(KEY_PREFIX));
      const records = await Promise.all(keys.map(async (key) => kv.get(key)));
      return records.filter(
        (record): record is InspectionCaptureRecord =>
          typeof record === 'object' && record !== null && 'photoValidation' in (record as object),
      );
    },
  };
}

export function resolveInspectionCaptureStore(): InspectionCaptureStore {
  const factory =
    typeof indexedDB !== 'undefined' ? (indexedDB as unknown as IDBFactoryLike) : undefined;
  if (factory && typeof factory.open === 'function') {
    return createInspectionCaptureStore(new IndexedDbKeyValueStore(factory));
  }
  return createInspectionCaptureStore(createMemoryKeyValueStore());
}
