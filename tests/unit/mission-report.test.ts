import { describe, expect, it } from 'vitest';
import { ScoringEngine } from '../../src/scoring/ScoringEngine';
import { DEFAULT_SCORE_CONFIG } from '../../src/scoring/config';
import { MISSION_STEP_ORDER } from '../../src/mission/types';
import type { ScoreSession, HazardEpisode, ScoreCaptureAttempt } from '../../src/scoring/types';
import type { InspectionAIResult, PhotoValidationResult, SafetyState } from '../../src/inspection/types';
import {
  buildMissionReport,
  buildReportSummary,
  sortReportsByCreatedAtDesc,
  summarizeHazards,
  toReportStatus,
  formatDuration,
  serializeReport,
  parseReport,
} from '../../src/report/mission-report';
import type { ReportCaptureEntry, MissionReportSummary } from '../../src/report/types';

/**
 * The report builder is pure: it only organises the real recorded data the
 * scoring engine already produced. These tests make sure a completed, failed and
 * unfinished mission each yield an honest, internally consistent report, and that
 * the JSON export round-trips and stays tolerant of older / partial payloads.
 */

const TARGET = { x: -7.4, y: 8, z: 4 };
const HOME = { x: 0, y: 0, z: 0 };
const COMPLETE_STEP = MISSION_STEP_ORDER.indexOf('COMPLETE');

function validPhoto(safety: SafetyState = 'SAFE'): PhotoValidationResult {
  return {
    targetVisible: true,
    coverageRatio: 0.35,
    distanceToTarget: 2.4,
    angleErrorDeg: 2,
    insideInspectionZone: true,
    safetyState: safety,
    valid: true,
    reasons: [],
  };
}

function aiMock(): InspectionAIResult {
  return { defectDetected: true, defectType: 'MISSING_INSULATOR_DISC', confidence: 0.9, source: 'mock' };
}

function capture(index: number, opts: { valid?: boolean; safety?: SafetyState; photo?: PhotoValidationResult } = {}): ReportCaptureEntry {
  const photo = opts.photo ?? validPhoto(opts.safety ?? 'SAFE');
  return {
    index,
    timestamp: 1_000 + index * 10,
    valid: opts.valid ?? photo.valid,
    photoValidation: photo,
    safetyState: opts.safety ?? 'SAFE',
    aiResult: photo.valid ? aiMock() : null,
    photoDataUrl: `data:image/png;base64,shot${index}`,
  };
}

function session(overrides: Partial<ScoreSession> = {}): ScoreSession {
  return {
    missionId: 'mission-test',
    missionFinalState: 'COMPLETE',
    missionBestStepIndex: COMPLETE_STEP,
    missionStepTotal: MISSION_STEP_ORDER.length,
    reachedInspectionComplete: true,
    missionFailed: false,
    durationMs: 60_000,
    homePoint: { ...HOME },
    targetPosition: { ...TARGET },
    pathLengthM: 20,
    maxAltitudeM: 8,
    enteredInspectionZone: true,
    hazardEpisodes: [],
    captureAttempts: [] as ScoreCaptureAttempt[],
    fullStickCount: 0,
    inputReversalCount: 0,
    hoverInputDeviation: 0,
    hoverSampleCount: 1,
    ...overrides,
  };
}

const engine = new ScoringEngine(DEFAULT_SCORE_CONFIG);

describe('MissionReport builder', () => {
  it('produces a complete report for a finished mission', () => {
    const sess = session();
    const score = engine.score(sess);
    const report = buildMissionReport({
      missionId: sess.missionId,
      taskName: '输电塔右侧绝缘子串巡检',
      targetId: 'INS-T1-RIGHT',
      targetName: '绝缘子串',
      startedAt: 1_000,
      finishedAt: 61_000,
      session: sess,
      score,
      captures: [capture(1)],
      controlSamples: [{ t: 0, roll: 0, pitch: 0, yaw: 0, throttle: 0.5 }],
    });

    expect(report.status).toBe('completed');
    expect(report.finalState).toBe('COMPLETE');
    expect(report.taskName).toBe('输电塔右侧绝缘子串巡检');
    expect(report.enteredInspectionZone).toBe(true);
    expect(report.captures).toHaveLength(1);
    expect(report.controlSamples).toHaveLength(1);
    expect(report.schemaVersion).toBe(1);
  });

  it('marks a FAILED mission and keeps the total under the safety ceiling', () => {
    const sess = session({
      missionFinalState: 'FAILED',
      missionBestStepIndex: MISSION_STEP_ORDER.indexOf('INSPECTION_COMPLETE'),
      reachedInspectionComplete: true,
      missionFailed: true,
      hazardEpisodes: [{ state: 'COLLISION', durationMs: 1200 }],
    });
    const score = engine.score(sess);
    const report = buildMissionReport({
      missionId: sess.missionId,
      taskName: '任务',
      targetId: 'T',
      targetName: '目标',
      startedAt: 1_000,
      finishedAt: 61_000,
      session: sess,
      score,
      captures: [capture(1)],
      controlSamples: [],
    });

    expect(report.status).toBe('failed');
    // A failed+collision run can never read 90+: the safety ceiling holds.
    expect(report.score.totalScore).toBeLessThanOrEqual(DEFAULT_SCORE_CONFIG.capCollisionTotal);
  });

  it('caps the total at 59 when a collision happens on an otherwise strong run', () => {
    // Collision without the mission being marked failed: the collision hard cap
    // must still bind so the score can never reach 90+.
    const sess = session({
      missionFinalState: 'COMPLETE',
      reachedInspectionComplete: true,
      missionFailed: false,
      hazardEpisodes: [{ state: 'COLLISION', durationMs: 1200 }],
      captureAttempts: [{ index: 1, photoValidation: validPhoto(), safetyState: 'SAFE' }],
    });
    const score = engine.score(sess);
    expect(score.capped).toBe(true);
    expect(score.totalScore).toBe(DEFAULT_SCORE_CONFIG.capCollisionTotal);
  });

  it('marks an unfinished mission as incomplete', () => {
    const sess = session({ missionFinalState: 'FLY_TO_TARGET', missionBestStepIndex: MISSION_STEP_ORDER.indexOf('FLY_TO_TARGET'), reachedInspectionComplete: false });
    const score = engine.score(sess);
    const report = buildMissionReport({
      missionId: sess.missionId,
      taskName: '任务',
      targetId: 'T',
      targetName: '目标',
      startedAt: 1_000,
      finishedAt: 30_000,
      session: sess,
      score,
      captures: [],
      controlSamples: [],
    });
    expect(report.status).toBe('incomplete');
  });

  it('keeps the six dimensions consistent with the total score', () => {
    const sess = session();
    const score = engine.score(sess);
    const sum = Object.values(score.dimensions).reduce((acc, dim) => acc + dim.score, 0);
    expect(Math.round(sum)).toBe(score.totalScore);
  });

  it('preserves every capture attempt, including invalid ones', () => {
    const sess = session({ captureAttempts: [] });
    const score = engine.score(sess);
    const captures = [capture(1, { valid: true }), capture(2, { valid: false, safety: 'DANGER' }), capture(3, { valid: true })];
    const report = buildMissionReport({
      missionId: sess.missionId,
      taskName: '任务',
      targetId: 'T',
      targetName: '目标',
      startedAt: 1_000,
      finishedAt: 61_000,
      session: sess,
      score,
      captures,
      controlSamples: [],
    });
    expect(report.captures).toHaveLength(3);
    expect(report.captures[0].valid).toBe(true);
    expect(report.captures[1].valid).toBe(false);
    expect(report.captures[1].safetyState).toBe('DANGER');
    expect(report.captures[0].photoDataUrl).toBe('data:image/png;base64,shot1');
  });

  it('preserves the Mock AI source label on each capture', () => {
    const sess = session();
    const score = engine.score(sess);
    const report = buildMissionReport({
      missionId: sess.missionId,
      taskName: '任务',
      targetId: 'T',
      targetName: '目标',
      startedAt: 1_000,
      finishedAt: 61_000,
      session: sess,
      score,
      captures: [capture(1)],
      controlSamples: [],
    });
    expect(report.captures[0].aiResult?.source).toBe('mock');
  });

  it('aggregates hazard episodes into count + duration', () => {
    const episodes: HazardEpisode[] = [
      { state: 'DANGER', durationMs: 3000 },
      { state: 'WARNING', durationMs: 1000 },
      { state: 'DANGER', durationMs: 1500 },
    ];
    const summary = summarizeHazards(episodes);
    const danger = summary.find((h) => h.state === 'DANGER');
    const warning = summary.find((h) => h.state === 'WARNING');
    expect(danger?.count).toBe(2);
    expect(danger?.totalDurationMs).toBe(4500);
    expect(warning?.count).toBe(1);
    expect(warning?.totalDurationMs).toBe(1000);

    const sess = session({ hazardEpisodes: episodes });
    const score = engine.score(sess);
    const report = buildMissionReport({
      missionId: sess.missionId,
      taskName: '任务',
      targetId: 'T',
      targetName: '目标',
      startedAt: 1_000,
      finishedAt: 61_000,
      session: sess,
      score,
      captures: [],
      controlSamples: [],
    });
    expect(report.hazardSummary).toHaveLength(2);
  });

  it('exports JSON and parses it back identically', () => {
    const sess = session();
    const score = engine.score(sess);
    const report = buildMissionReport({
      missionId: sess.missionId,
      taskName: '任务',
      targetId: 'T',
      targetName: '目标',
      startedAt: 1_000,
      finishedAt: 61_000,
      session: sess,
      score,
      captures: [capture(1)],
      controlSamples: [{ t: 123, roll: 0.1, pitch: -0.2, yaw: 0.3, throttle: 0.5 }],
    });
    const text = serializeReport(report);
    const parsed = parseReport(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.reportId).toBe(report.reportId);
    expect(parsed?.score.totalScore).toBe(report.score.totalScore);
    expect(parsed?.captures).toHaveLength(1);
    expect(parsed?.controlSamples).toHaveLength(1);
    expect(parsed?.hazardSummary).toEqual(report.hazardSummary);
  });

  it('returns null for invalid JSON and empty input', () => {
    expect(parseReport('')).toBeNull();
    expect(parseReport('not json')).toBeNull();
    expect(parseReport('{}')).toBeNull();
  });

  it('falls back to empty arrays for missing optional fields', () => {
    const minimal = JSON.stringify({
      reportId: 'r1',
      missionId: 'm1',
      score: { totalScore: 88, grade: 'PASS', dimensions: {}, majorIssues: [], suggestions: [] },
    });
    const parsed = parseReport(minimal);
    expect(parsed).not.toBeNull();
    expect(parsed?.captures).toEqual([]);
    expect(parsed?.controlSamples).toEqual([]);
    expect(parsed?.hazardSummary).toEqual([]);
    expect(parsed?.status).toBe('incomplete');
  });

  it('stays compatible with older exports that lack newer keys', () => {
    const legacy = JSON.stringify({
      reportId: 'r-legacy',
      missionId: 'm-legacy',
      finalState: 'COMPLETE',
      score: { totalScore: 95, grade: 'EXCELLENT', dimensions: {}, majorIssues: [], suggestions: [] },
    });
    const parsed = parseReport(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toBe('completed');
    expect(parsed?.controlSamples).toEqual([]);
    expect(parsed?.hazardSummary).toEqual([]);
    expect(parsed?.schemaVersion).toBe(1);
  });

  it('derives a status from the final mission state', () => {
    expect(toReportStatus('COMPLETE')).toBe('completed');
    expect(toReportStatus('FAILED')).toBe('failed');
    expect(toReportStatus('TAKEOFF')).toBe('incomplete');
  });

  it('formats duration as mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_600_000)).toBe('60:00');
  });
});

describe('MissionReport summary + history sorting', () => {
  function summary(overrides: Partial<MissionReportSummary> = {}): MissionReportSummary {
    return {
      reportId: 'r1',
      missionId: 'm1',
      taskName: '任务',
      date: '2026-10-17',
      createdAt: 1_000,
      finalState: 'COMPLETE',
      status: 'completed',
      totalScore: 90,
      grade: 'EXCELLENT',
      gradeLabel: 'EXCELLENT',
      hadCollision: false,
      ...overrides,
    };
  }

  it('builds a compact summary, flagging collisions', () => {
    const sess = session({
      missionFinalState: 'FAILED',
      missionFailed: true,
      hazardEpisodes: [{ state: 'COLLISION', durationMs: 500 }],
    });
    const score = engine.score(sess);
    const report = buildMissionReport({
      missionId: sess.missionId,
      taskName: '任务',
      targetId: 'T',
      targetName: '目标',
      startedAt: 1_000,
      finishedAt: 61_000,
      session: sess,
      score,
      captures: [],
      controlSamples: [],
    });
    const s = buildReportSummary(report);
    expect(s.totalScore).toBe(report.score.totalScore);
    expect(s.hadCollision).toBe(true);
    expect(s.status).toBe('failed');
  });

  it('sorts summaries newest-first', () => {
    const list = [summary({ createdAt: 1, reportId: 'a' }), summary({ createdAt: 3, reportId: 'c' }), summary({ createdAt: 2, reportId: 'b' })];
    const sorted = sortReportsByCreatedAtDesc(list);
    expect(sorted.map((s) => s.reportId)).toEqual(['c', 'b', 'a']);
  });
});
