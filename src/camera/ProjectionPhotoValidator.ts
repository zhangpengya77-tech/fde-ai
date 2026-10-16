import type { PhotoValidationResult, SafetyState, Vec3 } from '../inspection/types';

/**
 * Everything the validator needs to judge a single capture. Geometry only -
 * no Three.js, no pixels, so it is unit testable in plain Node. The browser
 * passes the *real* camera pose (position + world-space forward, after heading
 * + gimbal) that produced the RenderTarget capture.
 */
export interface PhotoSample {
  cameraPosition: Vec3;
  /** Unit vector the capture camera looks toward (world space). */
  cameraForward: Vec3;
  targetPosition: Vec3;
  /** Effective radius of the inspectable target (the insulator string), metres. */
  targetRadius: number;
  /** Camera viewport aspect ratio (width / height). */
  aspect: number;
  insideInspectionZone: boolean;
  safetyState: SafetyState;
}

/** Teaching parameters (NOT industry regulation). All configurable. */
export interface PhotoValidatorConfig {
  fovYDeg: number;
  /** Farther than this is rejected as "距离过远". */
  maxInspectionDistanceM: number;
  /** Closer than this is rejected as "距离过近". */
  minInspectionDistanceM: number;
  /** The target disc must be at least this fraction of the viewport. */
  minCoverageRatio: number;
  /** Gimbal aim must be within this many degrees of the target. */
  maxAngleErrorDeg: number;
}

export const DEFAULT_PHOTO_VALIDATOR_CONFIG: PhotoValidatorConfig = {
  fovYDeg: 50,
  maxInspectionDistanceM: 5,
  minInspectionDistanceM: 0.8,
  minCoverageRatio: 0.05,
  maxAngleErrorDeg: 15,
};

const EPS = 1e-9;

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}
function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len < EPS ? { x: 0, y: 0, z: 1 } : { x: a.x / len, y: a.y / len, z: a.z / len };
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Independent, projection-based photo-quality judge.
 *
 * It never invokes the (mock) AI and never looks at pixels: it decides whether
 * the frame *could* be a valid inspection photo - is the target in the frustum,
 * is it large enough, is the aircraft at a good distance, roughly aimed at it,
 * inside the zone and safe at the instant of the shot.
 */
export class ProjectionPhotoValidator {
  constructor(private readonly config: PhotoValidatorConfig = DEFAULT_PHOTO_VALIDATOR_CONFIG) {}

  validate(sample: PhotoSample): PhotoValidationResult {
    const forward = normalize(sample.cameraForward);
    // Pick a stable camera up vector (the world up unless we look straight along it).
    const worldUp: Vec3 = { x: 0, y: 1, z: 0 };
    let right = normalize(cross(forward, worldUp));
    if (length(right) < 1e-3) right = normalize(cross(forward, { x: 1, y: 0, z: 0 }));
    const camUp = cross(right, forward);

    const toTarget = sub(sample.targetPosition, sample.cameraPosition);
    const distanceToTarget = length(toTarget);
    const dirToTarget = distanceToTarget < EPS ? forward : normalize(toTarget);

    const cosAngle = clamp(dot(forward, dirToTarget), -1, 1);
    const angleErrorDeg = (Math.acos(cosAngle) * 180) / Math.PI;

    const depth = dot(toTarget, forward);
    const halfH = Math.tan((this.config.fovYDeg / 2) * (Math.PI / 180));
    const halfW = halfH * sample.aspect;
    const safeDepth = depth > EPS ? depth : 1;
    const ndcX = dot(toTarget, right) / (safeDepth * halfW);
    const ndcY = dot(toTarget, camUp) / (safeDepth * halfH);

    const targetVisible =
      depth > EPS && Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1;

    const projectedRadiusNdc = (sample.targetRadius / Math.max(distanceToTarget, EPS)) / halfH;
    const coverageRatio = clamp(2 * projectedRadiusNdc, 0, 1);

    const tooFar = distanceToTarget > this.config.maxInspectionDistanceM;
    const tooClose = distanceToTarget < this.config.minInspectionDistanceM;
    const badAngle = angleErrorDeg > this.config.maxAngleErrorDeg;
    const tooSmall = coverageRatio < this.config.minCoverageRatio;
    const unsafe = sample.safetyState === 'DANGER' || sample.safetyState === 'COLLISION';

    const reasons: string[] = [];
    if (!targetVisible) reasons.push('巡检目标未进入画面');
    if (tooFar) reasons.push('距离过远');
    if (tooClose) reasons.push('距离过近');
    if (badAngle) reasons.push('云台方向偏差过大');
    if (tooSmall) reasons.push('目标过小');
    if (!sample.insideInspectionZone) reasons.push('未进入巡检拍摄区');
    if (unsafe) reasons.push('拍摄位置存在安全风险');

    const valid =
      targetVisible &&
      !tooFar &&
      !tooClose &&
      !badAngle &&
      !tooSmall &&
      sample.insideInspectionZone &&
      !unsafe;

    return {
      targetVisible,
      coverageRatio,
      distanceToTarget,
      angleErrorDeg,
      insideInspectionZone: sample.insideInspectionZone,
      safetyState: sample.safetyState,
      valid,
      reasons,
    };
  }
}
