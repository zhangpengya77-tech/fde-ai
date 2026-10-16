import type { ProfileKeyValueStore, IDBFactoryLike } from '../ui/profile-store';
import {
  IndexedDbKeyValueStore,
  createMemoryKeyValueStore,
} from '../ui/profile-store';
import type { MissionReport, MissionReportSummary } from '../report/types';
import { buildReportSummary, sortReportsByCreatedAtDesc } from '../report/mission-report';

/**
 * P1-7 trainee-report storage. It reuses the exact same key/value layer the
 * device-profile and capture stores use (IndexedDB with an in-memory fallback),
 * isolated by its own key prefix, so a report is persisted now and the history
 * list / teacher view only have to read and present it.
 */
const KEY_PREFIX = 'fde.mission-report/';

export interface MissionReportStore {
  save(report: MissionReport): Promise<void>;
  get(reportId: string): Promise<MissionReport | null>;
  /** Compact, time-ordered (newest first) summaries for the history list. */
  list(): Promise<MissionReportSummary[]>;
  delete(reportId: string): Promise<void>;
}

function isReport(value: unknown): value is MissionReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    'reportId' in value &&
    'score' in value
  );
}

export function createMissionReportStore(kv: ProfileKeyValueStore): MissionReportStore {
  return {
    async save(report: MissionReport): Promise<void> {
      await kv.put(KEY_PREFIX + report.reportId, report);
    },
    async get(reportId: string): Promise<MissionReport | null> {
      const value = await kv.get(KEY_PREFIX + reportId);
      return isReport(value) ? value : null;
    },
    async list(): Promise<MissionReportSummary[]> {
      const keys = (await kv.keys()).filter((key) => key.startsWith(KEY_PREFIX));
      const reports = await Promise.all(
        keys.map(async (key) => {
          const value = await kv.get(key);
          return isReport(value) ? value : null;
        }),
      );
      return sortReportsByCreatedAtDesc(
        reports.filter((report): report is MissionReport => report !== null).map(buildReportSummary),
      );
    },
    async delete(reportId: string): Promise<void> {
      await kv.delete(KEY_PREFIX + reportId);
    },
  };
}

/** Picks the real IndexedDB store when the browser exposes one, else memory. */
export function resolveMissionReportStore(): MissionReportStore {
  const factory =
    typeof indexedDB !== 'undefined' ? (indexedDB as unknown as IDBFactoryLike) : undefined;
  if (factory && typeof factory.open === 'function') {
    return createMissionReportStore(new IndexedDbKeyValueStore(factory));
  }
  return createMissionReportStore(createMemoryKeyValueStore());
}
