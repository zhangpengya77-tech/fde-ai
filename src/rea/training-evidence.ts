import type { TrainingTaskId } from './training-template';

export type TrainingTaskStatus = 'PENDING' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'INVALID';
export type TelemetrySource = 'SITL_GATEWAY' | 'TEST_FIXTURE' | 'TEACHER_NOTE';

export interface TrainingEvidenceSample {
  sessionId: string;
  /** Gateway-attached identity retained by the client; not a server-side grade signature. */
  simulationInstanceId?: string;
  systemId?: number;
  componentId?: number;
  taskId: TrainingTaskId;
  source: TelemetrySource;
  /** Backwards-compatible alias of localSequence; never a Gateway-issued sample ID. */
  sampleId: number;
  /** Monotonic sequence assigned by the attached browser client. */
  localSequence?: number;
  /** telemetry_v2 currently exposes no Gateway sample identifier. */
  gatewaySampleId?: string | number;
  timestampMs: number;
  sourceTimestampMs?: number;
  receivedAtMs?: number;
  position: { x: number; y: number; altitudeM: number };
  attitudeDeg: { roll: number; pitch: number; yaw: number };
  /** Absent when the read-only observation has no velocity field. */
  velocityMps?: number;
  missionState: string;
  safetyEvents: string[];
  scoringRuleVersion: string;
  validity?: 'VALID';
}

export interface TrainingTaskRun {
  status: TrainingTaskStatus;
  sessionId: string | null;
  taskId: TrainingTaskId;
  scoringRuleVersion: string;
  samples: TrainingEvidenceSample[];
  reason: string | null;
}

const terminal = new Set<TrainingTaskStatus>(['COMPLETED', 'FAILED', 'CANCELLED', 'INVALID']);

export function createTrainingTaskRun(taskId: TrainingTaskId, scoringRuleVersion: string): TrainingTaskRun {
  return { status: 'PENDING', sessionId: null, taskId, scoringRuleVersion, samples: [], reason: null };
}

export function transitionTrainingTask(run: TrainingTaskRun, next: TrainingTaskStatus, reason: string | null = null): TrainingTaskRun {
  const allowed: Record<TrainingTaskStatus, TrainingTaskStatus[]> = {
    PENDING: ['READY', 'CANCELLED'], READY: ['RUNNING', 'CANCELLED', 'INVALID'], RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED', 'INVALID'],
    COMPLETED: [], FAILED: [], CANCELLED: [], INVALID: [],
  };
  if (!allowed[run.status].includes(next)) throw new Error(`invalid training transition: ${run.status} -> ${next}`);
  return { ...run, status: next, reason };
}

export function acceptEvidence(run: TrainingTaskRun, sample: TrainingEvidenceSample, freshnessMs: number, nowMs: number): TrainingTaskRun {
  if (run.status !== 'RUNNING') return { ...run, status: 'INVALID', reason: '非 RUNNING 狀態不得累積證據' };
  if (sample.source !== 'SITL_GATEWAY') return { ...run, status: 'INVALID', reason: '訓練有效證據必須是授權 SITL/Gateway 遙測' };
  if (sample.sessionId !== run.sessionId || sample.taskId !== run.taskId || sample.scoringRuleVersion !== run.scoringRuleVersion) return { ...run, status: 'INVALID', reason: 'Session、任務或評分規則版本不一致' };
  if (nowMs - sample.timestampMs > freshnessMs) return { ...run, status: 'INVALID', reason: '遙測資料過期' };
  if (run.samples.length && sample.sampleId <= run.samples.at(-1)!.sampleId) return { ...run, status: 'INVALID', reason: '樣本序號未單調遞增' };
  return { ...run, samples: [...run.samples, sample] };
}

export function startTrainingTask(run: TrainingTaskRun, sessionId: string): TrainingTaskRun {
  const ready = transitionTrainingTask(run, 'READY');
  return { ...transitionTrainingTask(ready, 'RUNNING'), sessionId };
}

export function invalidateForSessionLoss(run: TrainingTaskRun, reason: string): TrainingTaskRun {
  return terminal.has(run.status) ? run : { ...run, status: 'INVALID', reason };
}
