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

/** Input to a (mock or real) inspection AI adapter. */
export interface InspectionAIInput {
  targetId: string;
  defectType: InspectionDefectType;
  distanceToTarget: number;
  angleErrorDeg: number;
  coverageRatio: number;
}

/** Deterministic inspection result. `source` is always 'mock' in Phase 1. */
export interface InspectionAIResult {
  defectDetected: boolean;
  defectType: InspectionDefectType | null;
  /** Confidence 0..1 (deterministic for a given input; never Math.random). */
  confidence: number;
  source: 'mock';
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
