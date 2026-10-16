import type { MissionState } from '../mission/types';
import type { SafetyState, PhotoValidationResult, InspectionAIResult } from '../inspection/types';
import type { MissionScoreResult, ScoreGrade, ControlSample } from '../scoring/types';

/**
 * P1-7 trainee mission-report domain types. Pure data only - no Three.js, no DOM.
 * Every field is derived from real recorded flight/safety/photo/score data; the
 * UI shows "无记录" when a section is empty, it never invents content.
 */

/** Final mission outcome used for the trainee-facing status. */
export type ReportStatus = 'completed' | 'failed' | 'incomplete';

/** One captured photo, copied from the persisted `InspectionCaptureRecord`. */
export interface ReportCaptureEntry {
  index: number;
  timestamp: number;
  valid: boolean;
  photoValidation: PhotoValidationResult;
  safetyState: SafetyState;
  aiResult: InspectionAIResult | null;
  /** Real RenderTarget capture as a data URL (browser only, may be null). */
  photoDataUrl: string | null;
}

/** Aggregated non-safe stay, used by the report's safety-events section. */
export interface HazardEventSummary {
  state: Exclude<SafetyState, 'SAFE'>;
  count: number;
  totalDurationMs: number;
}

/**
 * The full, self-contained mission report. It is what gets persisted to
 * IndexedDB and exported as a standalone JSON file.
 */
export interface MissionReport {
  /** Bump only on a breaking shape change; old reports without it still parse. */
  schemaVersion: 1;
  reportId: string;
  missionId: string;
  taskName: string;
  targetId: string;
  targetName: string;
  /** Report-creation (mission-end) wall-clock time, ms. */
  createdAt: number;
  /** Mission start wall-clock time, ms. */
  startedAt: number;
  /** Mission end wall-clock time, ms. */
  finishedAt: number;
  finalState: MissionState;
  status: ReportStatus;
  /** Flight duration, ms (from the recorder's performance clock). */
  durationMs: number;
  pathLengthM: number;
  maxAltitudeM: number;
  enteredInspectionZone: boolean;
  /** Bounded time series of Roll/Pitch/Yaw/Throttle (empty when none recorded). */
  controlSamples: ControlSample[];
  captures: ReportCaptureEntry[];
  hazardSummary: HazardEventSummary[];
  score: MissionScoreResult;
}

/** Compact, list-friendly projection of a report (no photos / samples). */
export interface MissionReportSummary {
  reportId: string;
  missionId: string;
  taskName: string;
  /** YYYY-MM-DD of `createdAt`, for the history list. */
  date: string;
  createdAt: number;
  finalState: MissionState;
  status: ReportStatus;
  totalScore: number;
  grade: ScoreGrade;
  gradeLabel: string;
  hadCollision: boolean;
}
