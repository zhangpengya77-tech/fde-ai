/**
 * Pure gimbal angle model. Holds the teaching pitch/yaw state; the render layer
 * (create-app) is responsible for turning these angles into a Three.js camera
 * that rides with the F450. No Three.js here, so limits/recenter are unit
 * testable in plain Node.
 */
export interface GimbalLimits {
  /** Minimum pitch (deg, negative = looking down). */
  minPitchDeg: number;
  /** Maximum pitch (deg, positive = looking up). */
  maxPitchDeg: number;
  /** Yaw range is symmetric around 0 (deg). */
  maxYawDeg: number;
}

export const DEFAULT_GIMBAL_LIMITS: GimbalLimits = {
  minPitchDeg: -90,
  maxPitchDeg: 20,
  maxYawDeg: 135,
};

export class GimbalCamera {
  private pitchDeg = 0;
  private yawDeg = 0;

  constructor(private readonly limits: GimbalLimits = DEFAULT_GIMBAL_LIMITS) {}

  get pitch(): number {
    return this.pitchDeg;
  }

  get yaw(): number {
    return this.yawDeg;
  }

  /** Set pitch (positive up / negative down), clamped to the limits. */
  setPitch(deg: number): number {
    this.pitchDeg = clamp(deg, this.limits.minPitchDeg, this.limits.maxPitchDeg);
    return this.pitchDeg;
  }

  /** Set yaw (deg, + right / - left), clamped to [-maxYaw, +maxYaw]. */
  setYaw(deg: number): number {
    this.yawDeg = clamp(deg, -this.limits.maxYawDeg, this.limits.maxYawDeg);
    return this.yawDeg;
  }

  /** Nudge pitch by a delta (deg), clamped. Returns the new pitch. */
  nudgePitch(deltaDeg: number): number {
    return this.setPitch(this.pitchDeg + deltaDeg);
  }

  /** Nudge yaw by a delta (deg), clamped. Returns the new yaw. */
  nudgeYaw(deltaDeg: number): number {
    return this.setYaw(this.yawDeg + deltaDeg);
  }

  /** Return both axes to their neutral (0,0). */
  recenter(): void {
    this.pitchDeg = 0;
    this.yawDeg = 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
