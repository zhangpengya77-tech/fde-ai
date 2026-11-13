// 訓練證據管線：唯讀觀測 → 轉接器 → 證據 → 狀態機 → 評分（P5-J7 規則）
import { describe, expect, it } from 'vitest';
import { SUBJECT_TO_TRAINING_TASK, TRAINING_RULE_VERSION, TrainingEvidencePipeline } from '../../src/rea/training-pipeline';
import type { ReadOnlyObservation } from '../../src/rea/training-telemetry-adapter';
import type { CourseResult } from '../../src/rea/runner';

const binding = { sessionId: 'S1', simulationInstanceId: 'S1', systemId: 251, componentId: 1 };
const obs = (seq: number, t: number, pos: [number, number, number] = [0, 0, 1.5], extra: Partial<ReadOnlyObservation> = {}): ReadOnlyObservation => ({
  ...binding, sampleId: seq, sourceTimestamp: t, receivedTimestamp: t, positionEnu: pos,
  attitudeDeg: { roll: 0, pitch: 0, yaw: 0 }, mode: 'LOITER', armed: true, ...extra,
});
const result = (finished: boolean, failure: string | null = null): CourseResult =>
  ({ subjectId: 'hover', grade: 0, finished, failure, steps: [], durationS: 10, disclaimer: '' });

describe('訓練證據管線', () => {
  it('八個考照科目都對應到七項模板之一', () => {
    for (const task of Object.values(SUBJECT_TO_TRAINING_TASK)) {
      expect(['takeoff-land', 'hover', 'translate', 'orientation', 'circle', 'waypoints', 'emergency']).toContain(task);
    }
    expect(SUBJECT_TO_TRAINING_TASK.hover).toBe('orientation');
    expect(SUBJECT_TO_TRAINING_TASK['figure-eight']).toBe('circle');
  });

  it('正常流程：RUNNING → 累積證據 → COMPLETED → TRAINING_TEMPLATE／PENDING_TEACHER_REVIEW', () => {
    const p = TrainingEvidencePipeline.forSubject('hover', binding)!;
    expect(p.run.status).toBe('RUNNING');
    expect(p.run.sessionId).toBe('S1');
    for (let i = 1; i <= 5; i++) expect(p.observe(obs(i, 1000 + i * 100), 'live', 1000 + i * 100)).toBe('accepted');
    p.finish(result(true));
    const s = p.summary();
    expect(s.status).toBe('COMPLETED');
    expect(s.sampleCount).toBe(5);
    expect(s.classification).toBe('TRAINING_TEMPLATE');
    expect(s.score.recommendation).toBe('PENDING_TEACHER_REVIEW');
    expect(s.score.ruleVersion).toBe(TRAINING_RULE_VERSION);
    expect(s.sequenceSource).toBe('BROWSER_LOCAL_SEQUENCE');
    // 不得偽裝 Gateway 樣本 ID
    expect(p.run.samples.every((x) => x.gatewaySampleId === undefined && x.localSequence === x.sampleId && x.source === 'SITL_GATEWAY')).toBe(true);
  });

  it('尚未就緒（pending）只是等待，不判 INVALID', () => {
    const p = TrainingEvidencePipeline.forSubject('hover', binding)!;
    expect(p.observe(obs(1, 1000), 'pending', 1000)).toBe('LINK_PENDING');
    expect(p.run.status).toBe('RUNNING');
  });

  it.each([
    ['資料過期', (p: TrainingEvidencePipeline) => p.observe(obs(1, 1000), 'live', 9000), '過期'],
    ['連線過期', (p: TrainingEvidencePipeline) => p.observe(obs(1, 1000), 'stale', 1000), '過期'],
    ['Session 遺失（斷線）', (p: TrainingEvidencePipeline) => p.observe(obs(1, 1000), 'disconnected', 1000), 'Session 遺失'],
    ['來源不符（SYSID）', (p: TrainingEvidencePipeline) => p.observe(obs(1, 1000, [0, 0, 1], { systemId: 1 }), 'live', 1000), '不符'],
    ['亂序樣本', (p: TrainingEvidencePipeline) => { p.observe(obs(5, 1000), 'live', 1000); return p.observe(obs(4, 1100), 'live', 1100); }, '亂序'],
  ])('%s → INVALID，之後不再累積', (_name, act, reasonPart) => {
    const p = TrainingEvidencePipeline.forSubject('hover', binding)!;
    act(p);
    expect(p.run.status).toBe('INVALID');
    expect(p.run.reason).toContain(reasonPart);
    expect(p.observe(obs(99, 2000), 'live', 2000)).toBe('TERMINAL');
    p.finish(result(true));
    expect(p.run.status).toBe('INVALID'); // 終止狀態不可再轉
  });

  it('越出安全邊界記為安全事件（依考生面向旋轉）', () => {
    const p = TrainingEvidencePipeline.forSubject('hover', binding, 3_000, 90)!;
    // 面向東：往北 20 m ＝ 考場左方 20 m，超出 I 級場地 x ∈ [-15, 15]
    p.observe(obs(1, 1000, [0, 20, 2]), 'live', 1000);
    expect(p.run.samples[0].safetyEvents).toEqual(['越出安全邊界']);
    expect(p.summary().score.safetyEvents).toBe(1);
  });

  it('科目失敗 → FAILED；換科目 → CANCELLED；Session 遺失 → INVALID', () => {
    const a = TrainingEvidencePipeline.forSubject('hover', binding)!;
    a.finish(result(false, '墜機'));
    expect(a.run.status).toBe('FAILED');
    expect(a.run.reason).toBe('墜機');
    const b = TrainingEvidencePipeline.forSubject('hover', binding)!;
    b.cancel();
    expect(b.run.status).toBe('CANCELLED');
    const c = TrainingEvidencePipeline.forSubject('hover', binding)!;
    c.sessionLost('WebSocket 中斷');
    expect(c.run.status).toBe('INVALID');
  });
});

describe('教師唯讀匯出', () => {
  it('匯出紀錄只供覆核：無寫入授權、無教師決定、無秘密，深拷貝不受後續變動影響', async () => {
    const { buildTrainingExport, trainingExportFilename, TRAINING_EXPORT_SCHEMA } = await import('../../src/rea/training-pipeline');
    const p = TrainingEvidencePipeline.forSubject('figure-eight', binding)!;
    for (let i = 1; i <= 3; i++) p.observe(obs(i, 1000 + i * 100), 'live', 1000 + i * 100);
    p.finish(result(true));
    const rec = buildTrainingExport(p, 'figure-eight', new Date('2026-11-12T13:00:00Z'));
    expect(rec.schema).toBe(TRAINING_EXPORT_SCHEMA);
    expect(rec.teacherReview).toEqual({ status: 'PENDING_TEACHER_REVIEW', teacherDecision: null, writeAuthorization: 'NONE' });
    expect(rec.summary.status).toBe('COMPLETED');
    expect(rec.run.samples).toHaveLength(3);
    expect(JSON.stringify(rec)).not.toMatch(/ticket|token/i);
    p.cancel(); // 已終止，不變
    p.run.samples.push(p.run.samples[0]);
    expect(rec.run.samples).toHaveLength(3);
    expect(trainingExportFilename(rec)).toBe('fde-training-figure-eight-S1-2026-11-12T13-00-00-000Z.json');
  });
});
