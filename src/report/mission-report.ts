import type { MissionState } from '../mission/types';
import type { HazardEpisode, ScoreSession, ControlSample } from '../scoring/types';
import type {
  HazardEventSummary,
  MissionReport,
  MissionReportSummary,
  ReportCaptureEntry,
  ReportStatus,
} from './types';

/**
 * Pure, deterministic report assembly. It only *organises* real recorded data
 * (the ScoreSession the engine scored, the persisted captures, the control
 * trace) into the trainee-facing `MissionReport`. It invents nothing and uses
 * no randomness, so the same inputs always yield the same report.
 */

export interface BuildReportInput {
  missionId: string;
  taskName: string;
  targetId: string;
  targetName: string;
  /** Mission start wall-clock time, ms. */
  startedAt: number;
  /** Mission end wall-clock time, ms. */
  finishedAt: number;
  session: ScoreSession;
  score: MissionReport['score'];
  captures: ReportCaptureEntry[];
  controlSamples: ReadonlyArray<ControlSample>;
  /** Overrides report id / creation time (used by tests for determinism). */
  reportId?: string;
  now?: number;
}

export function toReportStatus(finalState: MissionState): ReportStatus {
  if (finalState === 'COMPLETE') return 'completed';
  if (finalState === 'FAILED') return 'failed';
  return 'incomplete';
}

export function summarizeHazards(episodes: HazardEpisode[]): HazardEventSummary[] {
  const buckets: Record<string, HazardEventSummary> = {};
  for (const episode of episodes) {
    const key = episode.state;
    if (!buckets[key]) buckets[key] = { state: key, count: 0, totalDurationMs: 0 };
    buckets[key].count += 1;
    buckets[key].totalDurationMs += Math.max(episode.durationMs, 0);
  }
  // Stable order: COLLISION, DANGER, WARNING.
  return (['COLLISION', 'DANGER', 'WARNING'] as const)
    .filter((state) => buckets[state])
    .map((state) => buckets[state]);
}

export function buildMissionReport(input: BuildReportInput): MissionReport {
  const { session, score } = input;
  const now = input.now ?? input.finishedAt;
  const reportId = input.reportId ?? `report-${input.missionId}-${input.finishedAt}`;
  return {
    schemaVersion: 1,
    reportId,
    missionId: input.missionId,
    taskName: input.taskName,
    targetId: input.targetId,
    targetName: input.targetName,
    createdAt: now,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    finalState: session.missionFinalState,
    status: toReportStatus(session.missionFinalState),
    durationMs: session.durationMs,
    pathLengthM: session.pathLengthM,
    maxAltitudeM: session.maxAltitudeM,
    enteredInspectionZone: session.enteredInspectionZone,
    controlSamples: [...input.controlSamples],
    captures: [...input.captures],
    hazardSummary: summarizeHazards(session.hazardEpisodes),
    score,
  };
}

export function buildReportSummary(report: MissionReport): MissionReportSummary {
  return {
    reportId: report.reportId,
    missionId: report.missionId,
    taskName: report.taskName,
    date: formatDate(report.createdAt),
    createdAt: report.createdAt,
    finalState: report.finalState,
    status: report.status,
    totalScore: report.score.totalScore,
    grade: report.score.grade,
    gradeLabel: report.score.capped ? `${report.score.grade}（封顶）` : report.score.grade,
    hadCollision: report.hazardSummary.some((hazard) => hazard.state === 'COLLISION'),
  };
}

export function sortReportsByCreatedAtDesc(list: MissionReportSummary[]): MissionReportSummary[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

/** mm:ss from a millisecond duration. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatDate(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// --- export / import --------------------------------------------------------

export function serializeReport(report: MissionReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Parse a report from exported JSON. Tolerant of missing optional fields and of
 * older exports that predate some keys (e.g. no `controlSamples`), so previously
 * saved reports stay readable. Returns `null` only when the payload is not a
 * usable report at all.
 */
export function parseReport(text: string): MissionReport | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const reportId = typeof obj.reportId === 'string' ? obj.reportId : null;
  const missionId = typeof obj.missionId === 'string' ? obj.missionId : null;
  const score = coerceScore(obj.score);
  if (!reportId || !missionId || !score) return null;

  const sessionLike = (obj as Partial<MissionReport>);
  const finalState = typeof sessionLike.finalState === 'string' ? sessionLike.finalState : 'IDLE';

  return {
    schemaVersion: 1,
    reportId,
    missionId,
    taskName: typeof obj.taskName === 'string' ? obj.taskName : '未命名任务',
    targetId: typeof obj.targetId === 'string' ? obj.targetId : '未知目标',
    targetName: typeof obj.targetName === 'string' ? obj.targetName : '未知目标',
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : 0,
    startedAt: typeof obj.startedAt === 'number' ? obj.startedAt : 0,
    finishedAt: typeof obj.finishedAt === 'number' ? obj.finishedAt : 0,
    finalState: finalState as MissionState,
    status: toReportStatus(finalState as MissionState),
    durationMs: typeof obj.durationMs === 'number' ? obj.durationMs : 0,
    pathLengthM: typeof obj.pathLengthM === 'number' ? obj.pathLengthM : 0,
    maxAltitudeM: typeof obj.maxAltitudeM === 'number' ? obj.maxAltitudeM : 0,
    enteredInspectionZone: Boolean(obj.enteredInspectionZone),
    controlSamples: Array.isArray(obj.controlSamples) ? (obj.controlSamples as ControlSample[]) : [],
    captures: Array.isArray(obj.captures) ? (obj.captures as ReportCaptureEntry[]) : [],
    hazardSummary: Array.isArray(obj.hazardSummary) ? (obj.hazardSummary as HazardEventSummary[]) : [],
    score,
  };
}

function coerceScore(raw: unknown): MissionReport['score'] | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.totalScore !== 'number' || typeof obj.grade !== 'string') return null;
  if (typeof obj.dimensions !== 'object' || obj.dimensions === null) return null;
  return {
    missionId: typeof obj.missionId === 'string' ? obj.missionId : '',
    totalScore: obj.totalScore,
    grade: obj.grade as MissionReport['score']['grade'],
    capped: Boolean(obj.capped),
    capReason: typeof obj.capReason === 'string' ? obj.capReason : null,
    dimensions: obj.dimensions as MissionReport['score']['dimensions'],
    majorIssues: Array.isArray(obj.majorIssues) ? (obj.majorIssues as string[]) : [],
    suggestions: Array.isArray(obj.suggestions) ? (obj.suggestions as string[]) : [],
  };
}
