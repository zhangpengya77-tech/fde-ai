import type { TrainingTaskRun } from './training-evidence';

export interface TrainingScoreRule { version: string; maxPositionDeviationM: number; maxAltitudeDeviationM: number; maxDurationS: number; }
export interface TrainingScore { classification: 'TRAINING_TEMPLATE'; ruleVersion: string; completion: number; safetyEvents: number; telemetryComplete: boolean; recommendation: 'PENDING_TEACHER_REVIEW'; }

export function scoreTrainingRun(run: TrainingTaskRun, rule: TrainingScoreRule): TrainingScore {
  const samples = run.samples;
  const lastT = samples.at(-1)?.timestampMs ?? 0;
  const firstT = samples[0]?.timestampMs ?? lastT;
  const durationOk = (lastT - firstT) / 1000 <= rule.maxDurationS;
  return {
    classification: 'TRAINING_TEMPLATE', ruleVersion: rule.version,
    completion: run.status === 'COMPLETED' ? 1 : 0,
    safetyEvents: samples.reduce((n, sample) => n + sample.safetyEvents.length, 0),
    telemetryComplete: samples.length > 0 && durationOk && samples.every((sample) => sample.scoringRuleVersion === rule.version),
    recommendation: 'PENDING_TEACHER_REVIEW',
  };
}
