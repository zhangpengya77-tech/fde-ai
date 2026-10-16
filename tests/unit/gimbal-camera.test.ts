import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GIMBAL_LIMITS,
  GimbalCamera,
  type GimbalLimits,
} from '../../src/camera/GimbalCamera';

describe('GimbalCamera', () => {
  it('starts centred at pitch 0 / yaw 0', () => {
    const gimbal = new GimbalCamera();
    expect(gimbal.pitch).toBe(0);
    expect(gimbal.yaw).toBe(0);
  });

  it('moves the gimbal and reads back the set angles', () => {
    const gimbal = new GimbalCamera();
    gimbal.setPitch(15);
    expect(gimbal.pitch).toBe(15);
    gimbal.setPitch(-90);
    expect(gimbal.pitch).toBe(-90);
  });

  it('clamps pitch to [minPitchDeg, maxPitchDeg]', () => {
    const gimbal = new GimbalCamera();
    expect(gimbal.setPitch(-120)).toBe(DEFAULT_GIMBAL_LIMITS.minPitchDeg);
    expect(gimbal.setPitch(45)).toBe(DEFAULT_GIMBAL_LIMITS.maxPitchDeg);
  });

  it('clamps yaw to [-maxYawDeg, +maxYawDeg]', () => {
    const gimbal = new GimbalCamera();
    expect(gimbal.setYaw(200)).toBe(DEFAULT_GIMBAL_LIMITS.maxYawDeg);
    expect(gimbal.setYaw(-200)).toBe(-DEFAULT_GIMBAL_LIMITS.maxYawDeg);
  });

  it('nudges pitch and yaw by a delta, respecting limits', () => {
    const gimbal = new GimbalCamera();
    expect(gimbal.nudgePitch(-10)).toBe(-10);
    expect(gimbal.nudgeYaw(25)).toBe(25);
    // Overflow via nudging is clamped, not wrapped.
    expect(gimbal.nudgeYaw(999)).toBe(DEFAULT_GIMBAL_LIMITS.maxYawDeg);
    expect(gimbal.nudgePitch(-999)).toBe(DEFAULT_GIMBAL_LIMITS.minPitchDeg);
  });

  it('returns both axes to 0 on recentre', () => {
    const gimbal = new GimbalCamera();
    gimbal.setPitch(-40);
    gimbal.setYaw(60);
    gimbal.recenter();
    expect(gimbal.pitch).toBe(0);
    expect(gimbal.yaw).toBe(0);
  });

  it('honours custom teaching limits', () => {
    const limits: GimbalLimits = { minPitchDeg: -45, maxPitchDeg: 15, maxYawDeg: 60 };
    const gimbal = new GimbalCamera(limits);
    expect(gimbal.setPitch(-90)).toBe(-45);
    expect(gimbal.setYaw(120)).toBe(60);
  });
});
