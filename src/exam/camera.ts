/**
 * 相機調整（縮放 + 環繞）——純函式層，Three.js 與 DOM 皆不依賴。
 *
 * 教師實測需求（2026-10-23）：畫面要能放大縮小，飛機視角要能調整。
 * 原本只有 V 鍵切三個固定視角（考生／追隨／俯視全景），無法微調。
 *
 * 調整量三項：
 *  - `fovDeg`：相機視角（鏡頭廣角）。數值越小＝看得越遠＝主體越大（放大）。
 *  - `orbitYawDeg`：繞目標的水平環繞角（度）。正值＝相機往目標右側繞。
 *  - `orbitPitchDeg`：俯仰偏移（度）。正值＝相機抬高。
 *
 * 環繞以「目標 → 相機」的向量轉球座標再轉回，因此三種視角共用同一套運算，
 * 且拖曳時的旋轉方向與畫面一致（往右拖＝場景跟著往右轉）。
 */

/** 調整上限（模擬假設，非官方；純為避免調到看不見或翻到地下）。 */
export const CAMERA_LIMITS = {
  /** 視角（鏡頭廣角）範圍與步進，單位度。 */
  fovMinDeg: 20,
  fovMaxDeg: 80,
  fovStepDeg: 5,
  fovDefaultDeg: 55,
  /** 俯仰偏移範圍：略為負值允許低視角，但不得翻到地面以下。 */
  pitchMinDeg: -6,
  pitchMaxDeg: 89,
  /** 相機不得低於此高度（公尺）。 */
  minEyeM: 0.3,
} as const;

export interface CameraAdjust {
  fovDeg: number;
  orbitYawDeg: number;
  orbitPitchDeg: number;
}

const DEG = Math.PI / 180;

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 預設調整量（相機視角取 Three.js 慣用的 55°）。 */
export function defaultCameraAdjust(): CameraAdjust {
  return { fovDeg: CAMERA_LIMITS.fovDefaultDeg, orbitYawDeg: 0, orbitPitchDeg: 0 };
}

/** 縮放：dir = +1 放大（視角變小），dir = -1 縮小。已夾在允許範圍內。 */
export function zoomFovDeg(currentFovDeg: number, dir: 1 | -1): number {
  const next = currentFovDeg - dir * CAMERA_LIMITS.fovStepDeg;
  return clamp(next, CAMERA_LIMITS.fovMinDeg, CAMERA_LIMITS.fovMaxDeg);
}

/** 環繞角累加，並正規化到 (−180, 180]，避免長時間拖曳後數值無限制膨脹。 */
export function addOrbitYawDeg(currentDeg: number, deltaDeg: number): number {
  const sum = currentDeg + deltaDeg;
  if (!Number.isFinite(sum)) return 0;
  let n = sum % 360;
  if (n > 180) n -= 360;
  if (n <= -180) n += 360;
  return n;
}

/** 俯仰累加（夾在允許範圍）。 */
export function addOrbitPitchDeg(currentDeg: number, deltaDeg: number): number {
  return clamp(currentDeg + deltaDeg, CAMERA_LIMITS.pitchMinDeg, CAMERA_LIMITS.pitchMaxDeg);
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 把「目標 → 相機」的向量依環繞量旋轉。
 *
 * 球座標：方位角 azimuth = atan2(x, z)，仰角 elevation = asin(y / r)。
 * 回傳的向量長度與原向量相同（純旋轉，不改變與目標的距離）。
 */
export function applyOrbitOffset(rel: Vec3, orbitYawDeg: number, orbitPitchDeg: number): Vec3 {
  const radius = Math.hypot(rel.x, rel.y, rel.z);
  if (radius < 1e-6) return { x: 0, y: 0, z: 0 };
  const azimuth = Math.atan2(rel.x, rel.z) + orbitYawDeg * DEG;
  const elevation = clamp(
    Math.asin(clamp(rel.y / radius, -1, 1)) + orbitPitchDeg * DEG,
    CAMERA_LIMITS.pitchMinDeg * DEG,
    CAMERA_LIMITS.pitchMaxDeg * DEG,
  );
  const cosE = Math.cos(elevation);
  return {
    x: radius * cosE * Math.sin(azimuth),
    y: radius * Math.sin(elevation),
    z: radius * cosE * Math.cos(azimuth),
  };
}

/** 相機最終位置 = 目標 + 旋轉後的偏移，並夾在地面以上。 */
export function resolveCameraPosition(target: Vec3, rel: Vec3, orbitYawDeg: number, orbitPitchDeg: number): Vec3 {
  const off = applyOrbitOffset(rel, orbitYawDeg, orbitPitchDeg);
  return {
    x: target.x + off.x,
    y: Math.max(CAMERA_LIMITS.minEyeM, target.y + off.y),
    z: target.z + off.z,
  };
}