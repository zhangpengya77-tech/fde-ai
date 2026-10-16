import { describe, expect, it } from 'vitest';

import {
  ProjectionPhotoValidator,
  DEFAULT_PHOTO_VALIDATOR_CONFIG,
  type PhotoSample,
} from '../../src/camera/ProjectionPhotoValidator';
import type { SafetyState, Vec3 } from '../../src/inspection/types';

const TARGET: Vec3 = { x: -7.4, y: 8, z: 4 };
const ASPECT = 16 / 9;

function sample(overrides: Partial<PhotoSample> = {}): PhotoSample {
  // Default: aircraft 2.4 m to the +x of the target, looking straight at it.
  const cameraPosition: Vec3 = { x: TARGET.x + 2.4, y: 8, z: 4 };
  const cameraForward: Vec3 = { x: -1, y: 0, z: 0 };
  return {
    cameraPosition,
    cameraForward,
    targetPosition: TARGET,
    targetRadius: 0.3,
    aspect: ASPECT,
    insideInspectionZone: true,
    safetyState: 'WARNING' as SafetyState,
    ...overrides,
  };
}

/** Camera placed at `pos`, aimed exactly at the target. */
function aimedAt(pos: Vec3, overrides: Partial<PhotoSample> = {}): PhotoSample {
  const cameraForward: Vec3 = {
    x: TARGET.x - pos.x,
    y: TARGET.y - pos.y,
    z: TARGET.z - pos.z,
  };
  return sample({ cameraPosition: pos, cameraForward, ...overrides });
}

function withZone(s: PhotoSample, insideInspectionZone: boolean): PhotoSample {
  return { ...s, insideInspectionZone };
}

describe('ProjectionPhotoValidator', () => {
  const validator = new ProjectionPhotoValidator();

  it('accepts a well-framed, aimed, in-zone, safe capture', () => {
    const result = validator.validate(sample());
    expect(result.targetVisible).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.coverageRatio).toBeGreaterThan(DEFAULT_PHOTO_VALIDATOR_CONFIG.minCoverageRatio);
    expect(result.angleErrorDeg).toBeCloseTo(0, 5);
  });

  it('rejects a frame where the target never entered the frustum', () => {
    // Camera looks along -z while the target is off to -x.
    const result = validator.validate(
      sample({ cameraPosition: { x: 0, y: 8, z: 0 }, cameraForward: { x: 0, y: 0, z: -1 } }),
    );
    expect(result.targetVisible).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('巡检目标未进入画面');
    expect(result.angleErrorDeg).toBeGreaterThan(DEFAULT_PHOTO_VALIDATOR_CONFIG.maxAngleErrorDeg);
  });

  it('rejects when the target is too far away', () => {
    const result = validator.validate(withZone(aimedAt({ x: TARGET.x + 7.4, y: 8, z: 4 }), true));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('距离过远');
  });

  it('rejects when the target is too close (approaching the structure)', () => {
    const result = validator.validate(aimedAt({ x: TARGET.x + 0.5, y: 8, z: 4 }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('距离过近');
  });

  it('rejects when the gimbal aim is off (target framed but not centred)', () => {
    // Same good position, but the camera points far off the target.
    const result = validator.validate(sample({ cameraForward: { x: -0.2, y: 0, z: 1 } }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('云台方向偏差过大');
  });

  it('rejects a capture outside the inspection zone', () => {
    const result = validator.validate(withZone(sample(), false));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('未进入巡检拍摄区');
  });

  it('rejects a capture taken in DANGER', () => {
    const result = validator.validate(sample({ safetyState: 'DANGER' }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('拍摄位置存在安全风险');
  });

  it('rejects a capture taken in COLLISION', () => {
    const result = validator.validate(sample({ safetyState: 'COLLISION' }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('拍摄位置存在安全风险');
  });

  it('rejects when the target is framed but far too small (tiny target radius)', () => {
    const result = validator.validate(aimedAt({ x: TARGET.x + 2, y: 8, z: 4 }, { targetRadius: 0.001 }));
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('目标过小');
  });

  it('reports the real distance and a growing coverage as the aircraft approaches', () => {
    const far = validator.validate(withZone(aimedAt({ x: TARGET.x + 4, y: 8, z: 4 }), true));
    const near = validator.validate(withZone(aimedAt({ x: TARGET.x + 1.5, y: 8, z: 4 }), true));
    expect(far.distanceToTarget).toBeGreaterThan(near.distanceToTarget);
    expect(near.coverageRatio).toBeGreaterThan(far.coverageRatio);
  });
});
