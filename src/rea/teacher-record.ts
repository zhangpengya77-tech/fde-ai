/** Teacher-review record for REA teaching templates, never an official verdict. */
import type { TrainingTaskId } from './training-template';

export interface TeacherTelemetrySample {
  t: number;
  x: number;
  y: number;
  h: number;
  heading: number;
  pitchDeg: number;
  rollDeg: number;
  stepIndex: number;
}

export interface TeacherTrainingRecord {
  classification: 'TRAINING_TEMPLATE';
  source: 'SESSION_TELEMETRY';
  sessionId: string;
  taskId: TrainingTaskId;
  startedAt: string;
  trajectory: TeacherTelemetrySample[];
  summary: { durationS: number; maxHorizontalDeviationM: number; maxAltitudeM: number; maxTiltDeg: number; lastStepIndex: number };
  teacherReview: { status: 'PENDING'; notes: string | null };
}

export function createTeacherTrainingRecord(input: {
  sessionId: string;
  taskId: TrainingTaskId;
  startedAt: string;
  samples: TeacherTelemetrySample[];
}): TeacherTrainingRecord {
  const samples = input.samples.map((sample) => ({ ...sample }));
  const last = samples.at(-1);
  return {
    classification: 'TRAINING_TEMPLATE',
    source: 'SESSION_TELEMETRY',
    sessionId: input.sessionId,
    taskId: input.taskId,
    startedAt: input.startedAt,
    trajectory: samples,
    summary: {
      durationS: last?.t ?? 0,
      maxHorizontalDeviationM: samples.reduce((max, sample) => Math.max(max, Math.hypot(sample.x, sample.y)), 0),
      maxAltitudeM: samples.reduce((max, sample) => Math.max(max, sample.h), 0),
      maxTiltDeg: samples.reduce((max, sample) => Math.max(max, Math.abs(sample.pitchDeg), Math.abs(sample.rollDeg)), 0),
      lastStepIndex: last?.stepIndex ?? -1,
    },
    teacherReview: { status: 'PENDING', notes: null },
  };
}

export function exportTeacherTrainingRecord(record: TeacherTrainingRecord): string {
  return JSON.stringify(record, null, 2);
}
