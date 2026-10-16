import { describe, expect, it } from 'vitest';
import { createMemoryKeyValueStore } from '../../src/ui/profile-store';
import { createMissionReportStore } from '../../src/persistence/mission-report-store';
import type { MissionReport } from '../../src/report/types';

/**
 * The report store is exercised with the in-memory key/value backend so it stays
 * deterministic in Node. The IndexedDB path is the same code path in the
 * browser (the resolve* helper only swaps the backend).
 */

function makeReport(reportId: string, createdAt: number, totalScore = 90, hadCollision = false): MissionReport {
  return {
    schemaVersion: 1,
    reportId,
    missionId: `mission-${reportId}`,
    taskName: '输电塔右侧绝缘子串巡检',
    targetId: 'INS-T1-RIGHT',
    targetName: '绝缘子串',
    createdAt,
    startedAt: createdAt - 60_000,
    finishedAt: createdAt,
    finalState: hadCollision ? 'FAILED' : 'COMPLETE',
    status: hadCollision ? 'failed' : 'completed',
    durationMs: 60_000,
    pathLengthM: 20,
    maxAltitudeM: 8,
    enteredInspectionZone: true,
    controlSamples: [],
    captures: [],
    hazardSummary: hadCollision ? [{ state: 'COLLISION', count: 1, totalDurationMs: 500 }] : [],
    score: {
      missionId: `mission-${reportId}`,
      totalScore,
      grade: totalScore >= 90 ? 'EXCELLENT' : 'PASS',
      capped: hadCollision,
      capReason: hadCollision ? '发生碰撞，总分受限（最高 59 分）' : null,
      dimensions: {} as MissionReport['score']['dimensions'],
      majorIssues: [],
      suggestions: [],
    },
  };
}

describe('MissionReportStore (in-memory backend)', () => {
  it('saves and reads a single report', async () => {
    const store = createMissionReportStore(createMemoryKeyValueStore());
    const report = makeReport('r1', 1_000);
    await store.save(report);
    const fetched = await store.get('r1');
    expect(fetched?.reportId).toBe('r1');
    expect(fetched?.score.totalScore).toBe(90);
  });

  it('lists summaries newest-first and flags collisions', async () => {
    const store = createMissionReportStore(createMemoryKeyValueStore());
    await store.save(makeReport('older', 1_000, 95));
    await store.save(makeReport('newer', 5_000, 88));
    await store.save(makeReport('collision', 9_000, 28, true));
    const list = await store.list();
    expect(list.map((s) => s.reportId)).toEqual(['collision', 'newer', 'older']);
    const collision = list.find((s) => s.reportId === 'collision');
    expect(collision?.hadCollision).toBe(true);
    expect(collision?.status).toBe('failed');
  });

  it('returns null for an unknown report id', async () => {
    const store = createMissionReportStore(createMemoryKeyValueStore());
    expect(await store.get('missing')).toBeNull();
  });

  it('deletes a report', async () => {
    const store = createMissionReportStore(createMemoryKeyValueStore());
    await store.save(makeReport('r1', 1_000));
    await store.delete('r1');
    expect(await store.get('r1')).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });
});
