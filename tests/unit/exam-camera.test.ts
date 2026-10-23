import { describe, expect, it } from 'vitest';

import {
  CAMERA_LIMITS,
  addOrbitPitchDeg,
  addOrbitYawDeg,
  applyOrbitOffset,
  clamp,
  defaultCameraAdjust,
  resolveCameraPosition,
  zoomFovDeg,
} from '../../src/exam/camera';

/**
 * 教師實測需求（2026-10-23）：畫面可放大縮小、飛機視角可調整。
 * 這裡只測純函式層：範圍夾制、旋轉方向、與目標距離不變、不會翻到地面以下。
 */
describe('相機調整 — 縮放（視角）', () => {
  it('預設視角 55°', () => {
    expect(defaultCameraAdjust()).toEqual({ fovDeg: 55, orbitYawDeg: 0, orbitPitchDeg: 0 });
    expect(CAMERA_LIMITS.fovDefaultDeg).toBe(55);
  });

  it('放大＝視角變小、縮小＝視角變大（方向不能反）', () => {
    expect(zoomFovDeg(55, 1)).toBe(50);
    expect(zoomFovDeg(55, -1)).toBe(60);
    // 連續放大 10 步：55 → 5，但不得低於 fovMinDeg。
    let fov = 55;
    for (let i = 0; i < 10; i += 1) fov = zoomFovDeg(fov, 1);
    expect(fov).toBe(CAMERA_LIMITS.fovMinDeg);
  });

  it('縮小不會超過 fovMaxDeg', () => {
    let fov = 55;
    for (let i = 0; i < 10; i += 1) fov = zoomFovDeg(fov, -1);
    expect(fov).toBe(CAMERA_LIMITS.fovMaxDeg);
  });

  it('clamp 對 NaN 回傳下限（避免髒資料把相機弄壞）', () => {
    expect(clamp(Number.NaN, 20, 80)).toBe(20);
    expect(clamp(999, 20, 80)).toBe(80);
  });
});

describe('相機調整 — 環繞', () => {
  it('水平環繞只改方向、不改變與目標的距離', () => {
    const rel = { x: 0, y: 1.25, z: 7 }; // 考生視角：眼高 1.6 - 目標 0.35、後方 7
    const before = Math.hypot(rel.x, rel.y, rel.z);
    const rotated = applyOrbitOffset(rel, 90, 0);
    const after = Math.hypot(rotated.x, rotated.y, rotated.z);
    expect(after).toBeCloseTo(before, 6);
  });

  it('往右拖曳：相機轉到目標的另一側（場景跟著轉）', () => {
    // 相機原本在目標正後方（+Z）；繞 90° 後應移到 +X 側。
    const rotated = applyOrbitOffset({ x: 0, y: 0, z: 7 }, 90, 0);
    expect(rotated.x).toBeCloseTo(7, 6);
    expect(rotated.z).toBeCloseTo(0, 6);
  });

  it('俯仰偏移會抬高相機，且被 pitchMaxDeg 夾住（不會翻到頭頂再穿地）', () => {
    const rel = { x: 0, y: 1.25, z: 7 };
    const up = applyOrbitOffset(rel, 0, 30);
    expect(up.y).toBeGreaterThan(rel.y);
    const steep = applyOrbitOffset(rel, 0, 999);
    // 仰角被夾在 89°：y = r·sin89°、水平分量 = r·cos89°（幾乎正上方）。
    const r = Math.hypot(rel.x, rel.y, rel.z);
    expect(steep.y).toBeCloseTo(r * Math.sin((89 * Math.PI) / 180), 6);
    expect(Math.hypot(steep.x, steep.z)).toBeCloseTo(r * Math.cos((89 * Math.PI) / 180), 6);
    expect(Math.hypot(steep.x, steep.z)).toBeLessThan(0.2);
  });

  it('環繞角累加會正規化，不會無限膨脹', () => {
    expect(addOrbitYawDeg(0, 30)).toBe(30);
    expect(addOrbitYawDeg(170, 30)).toBe(-160);
    expect(addOrbitYawDeg(-170, -30)).toBe(160);
    let yaw = 0;
    for (let i = 0; i < 100; i += 1) yaw = addOrbitYawDeg(yaw, 45);
    expect(Math.abs(yaw)).toBeLessThanOrEqual(180);
  });

  it('俯仰累加被夾在允許範圍內', () => {
    expect(addOrbitPitchDeg(0, 10)).toBe(10);
    expect(addOrbitPitchDeg(80, 40)).toBe(CAMERA_LIMITS.pitchMaxDeg);
    expect(addOrbitPitchDeg(-5, -40)).toBe(CAMERA_LIMITS.pitchMinDeg);
  });

  it('相機不會低於地面 0.3m', () => {
    const pos = resolveCameraPosition({ x: 0, y: 0.35, z: 0 }, { x: 0, y: -2, z: 5 }, 0, -30);
    expect(pos.y).toBe(CAMERA_LIMITS.minEyeM);
  });

  it('零長度向量不會產生 NaN（機體與相機重疊時）', () => {
    const p = resolveCameraPosition({ x: 1, y: 1, z: 1 }, { x: 0, y: 0, z: 0 }, 45, 10);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(p.z)).toBe(true);
  });
});