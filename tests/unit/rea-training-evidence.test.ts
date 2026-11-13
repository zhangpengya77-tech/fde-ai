import { describe, expect, it } from 'vitest';
import { acceptEvidence, createTrainingTaskRun, invalidateForSessionLoss, startTrainingTask, transitionTrainingTask } from '../../src/rea/training-evidence';
import { scoreTrainingRun } from '../../src/rea/training-score';

const sample = (id: number, overrides = {}) => ({ sessionId: 's1', taskId: 'hover' as const, source: 'SITL_GATEWAY' as const, sampleId: id, timestampMs: 1000 + id, position: { x: 0, y: 0, altitudeM: 1.5 }, attitudeDeg: { roll: 0, pitch: 0, yaw: 0 }, velocityMps: 0, missionState: 'AUTO', safetyEvents: [], scoringRuleVersion: 'j7-v1', ...overrides });

describe('J7 training evidence state machine', () => {
  it('requires the explicit PENDING → READY → RUNNING chain', () => expect(startTrainingTask(createTrainingTaskRun('hover', 'j7-v1'), 's1').status).toBe('RUNNING'));
  it('rejects invalid terminal transitions', () => expect(() => transitionTrainingTask(createTrainingTaskRun('hover', 'j7-v1'), 'COMPLETED')).toThrow());
  it('accepts only fresh, monotonic authorized SITL/Gateway evidence', () => {
    let run = startTrainingTask(createTrainingTaskRun('hover', 'j7-v1'), 's1'); run = acceptEvidence(run, sample(1), 1000, 1500); expect(run.samples).toHaveLength(1); expect(acceptEvidence(run, sample(1), 1000, 1500).status).toBe('INVALID');
  });
  it('invalidates fixture, stale telemetry and session loss', () => {
    const run = startTrainingTask(createTrainingTaskRun('hover', 'j7-v1'), 's1'); expect(acceptEvidence(run, sample(1, { source: 'TEST_FIXTURE' }), 1000, 1500).status).toBe('INVALID'); expect(acceptEvidence(run, sample(1), 10, 2000).status).toBe('INVALID'); expect(invalidateForSessionLoss(run, 'session deleted').status).toBe('INVALID');
  });
  it('keeps score as training recommendation pending teacher review', () => {
    const run = transitionTrainingTask(startTrainingTask(createTrainingTaskRun('hover', 'j7-v1'), 's1'), 'COMPLETED'); expect(scoreTrainingRun(run, { version: 'j7-v1', maxPositionDeviationM: 1, maxAltitudeDeviationM: 1, maxDurationS: 60 }).recommendation).toBe('PENDING_TEACHER_REVIEW');
  });
});
