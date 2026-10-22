/**
 * Shared inspection domain types. Pure data only - no Three.js, no DOM.
 * The flight/safety business logic consumes these and never reaches into the
 * render layer, so the geometry contract stays unit-testable in plain Node.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type SafetyState = 'SAFE' | 'WARNING' | 'DANGER' | 'COLLISION';

/**
 * The single, real-distance result the safety layer computes every frame.
 * `SafetyDistanceEngine` is the only producer; the UI only reads it.
 */
export interface InspectionGeometryResult {
  /** 3D distance from the aircraft to the inspection target (insulator string). */
  distanceToTarget: number;
  /** 3D distance from the aircraft to the nearest transmission tower structure. */
  distanceToTower: number;
  /** 3D distance from the aircraft to the nearest sagging power line. */
  distanceToWire: number;
  /** True once the aircraft is inside the inspection zone around the target. */
  insideInspectionZone: boolean;
  /** Worst-case safety classification across every hazard. */
  safetyState: SafetyState;
}

export type InspectionDefectType = 'MISSING_INSULATOR_DISC';

/** Result of the independent projection-based photo quality validator. */
export interface PhotoValidationResult {
  /** Whether the inspection target projects inside the camera frustum. */
  targetVisible: boolean;
  /** Fraction of the viewport the target's disc occupies (0..1). */
  coverageRatio: number;
  /** 3D distance from the aircraft to the target at capture time. */
  distanceToTarget: number;
  /** Angular error between the gimbal aim and the direction to the target. */
  angleErrorDeg: number;
  /** Whether the capture happened inside the inspection zone. */
  insideInspectionZone: boolean;
  /** Safety classification at the moment of capture. */
  safetyState: SafetyState;
  /** True only if every teaching threshold is satisfied. */
  valid: boolean;
  /** Concrete Chinese reasons when the photo is not acceptable. */
  reasons: string[];
}

/**
 * The captured frame handed to an inspection AI. A data URL keeps the contract
 * identical in the browser (real RenderTarget capture) and in Node tests.
 */
export interface InspectionAIImage {
  /** `data:image/png;base64,...` of the real capture. */
  dataUrl: string;
}

/**
 * Input to a (mock or real) inspection AI adapter.
 *
 * This contract deliberately contains **no ground truth**. The scene's planted
 * defect (`layout.target.defectType`) must never reach a detector, otherwise a
 * real model could be scored against a leaked answer. Everything here is
 * observable from the aircraft at capture time:
 *
 * - `requestId` / `targetId` identify the request and the physical target
 *   (identity, not its condition);
 * - `image` is the evidence a vision model is supposed to judge;
 * - the three geometry fields describe the camera pose, not the answer.
 */
export interface InspectionAIInput {
  /** Stable id of this capture request, for tracing - never an answer. */
  requestId: string;
  /** Which physical target was photographed. Identity only, not its defect. */
  targetId: string;
  /** The captured frame; null when no image could be produced. */
  image: InspectionAIImage | null;
  distanceToTarget: number;
  angleErrorDeg: number;
  coverageRatio: number;
}

/**
 * Where a verdict came from.
 * - `mock`        : deterministic teaching simulation (never a real model);
 * - `real`        : an actual vision model produced this verdict;
 * - `unavailable` : no verdict exists (missing image, model down, call failed).
 */
export type InspectionAISource = 'mock' | 'real' | 'unavailable';

/** Deterministic inspection result. */
export interface InspectionAIResult {
  defectDetected: boolean;
  defectType: InspectionDefectType | null;
  /** Confidence 0..1 (deterministic for a given input; never Math.random). */
  confidence: number;
  /** Origin of the verdict. A simulation must never report `real`. */
  source: InspectionAISource;
  /**
   * Why no verdict is available. Adapters must set this whenever
   * `source === 'unavailable'` so a missing image can never be silently read
   * as "no defect". Optional only for backward compatibility with reports
   * persisted before this contract existed.
   */
  reason?: string | null;
}

/** How a consumer must read an AI result. */
export type InspectionAIVerdict = 'defect' | 'clear' | 'unavailable';

/**
 * Single source of truth for reading an AI result.
 *
 * A missing result and an `unavailable` result are **not** "clear": they mean
 * the defect question was never answered. Consumers (report, HUD) must branch
 * on this helper instead of testing `defectDetected` alone.
 */
export function classifyInspectionAIResult(result: InspectionAIResult | null): InspectionAIVerdict {
  if (!result || result.source === 'unavailable') return 'unavailable';
  return result.defectDetected ? 'defect' : 'clear';
}

/** The captured evidence record; persisted now, surfaced in the P1-7 report. */
export interface InspectionCaptureRecord {
  id: string;
  missionId: string;
  timestamp: number;
  targetId: string;
  aircraftPosition: Vec3;
  altitude: number;
  /** Aircraft roll/pitch/yaw in degrees. */
  attitude: { rollDeg: number; pitchDeg: number; yawDeg: number };
  gimbalPitchDeg: number;
  gimbalYawDeg: number;
  distanceToTarget: number;
  distanceToWire: number;
  distanceToTower: number;
  safetyState: SafetyState;
  photoValidation: PhotoValidationResult;
  aiResult: InspectionAIResult | null;
  /** Data URL of the real RenderTarget capture (browser only). */
  photoDataUrl: string | null;
}
