import { describe, expect, it } from 'vitest';
import { createTeacherTrainingRecord, exportTeacherTrainingRecord } from '../../src/rea/teacher-record';

describe('J6 teacher training record', () => {
  it('summarizes authoritative session samples as a training record', () => {
    const record = createTeacherTrainingRecord({
      sessionId: 'session-1', taskId: 'hover', startedAt: '2026-11-12T00:00:00.000Z',
      samples: [
        { t: 0, x: 0, y: 0, h: 0, heading: 0, pitchDeg: 0, rollDeg: 0, stepIndex: 0 },
        { t: 3, x: 0.3, y: 0.4, h: 1.5, heading: 8, pitchDeg: 3, rollDeg: 2, stepIndex: 1 },
      ],
    });
    expect(record.classification).toBe('TRAINING_TEMPLATE');
    expect(record.source).toBe('SESSION_TELEMETRY');
    expect(record.summary.maxHorizontalDeviationM).toBeCloseTo(0.5);
    expect(record.teacherReview.status).toBe('PENDING');
  });

  it('exports data without an official-exam verdict', () => {
    const json = exportTeacherTrainingRecord(createTeacherTrainingRecord({ sessionId: 's', taskId: 'circle', startedAt: 'x', samples: [] }));
    expect(json).toContain('TRAINING_TEMPLATE');
    expect(json).toContain('PENDING');
    expect(json).not.toContain('OFFICIAL_CERTIFICATION');
  });
});
