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
