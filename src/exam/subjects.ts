/**
 * 科目判定 S/U/N（CAA 專業基本級術科考場模擬，subjects B/C，p162/p163）。
 *
 * 由「原始量測」產生 S/U/N（模擬判定，非官方測驗結果）。官方僅給質性描述
 * （高度 1~2m、定點懸停 ≥5s、機頭順時針轉 90°、起落架不超過標示、等速、
 * 轉彎不得停頓、不得偏出八字標示）；量化閾值一律取 simAssist（模擬假設，
 * 非官方，可調）。原始量測同步記錄供人工審閱。
 *
 * S/U/N 定義（附錄5 p220）：S=操作程序均正確無誤；U=判定為不合格；
 * N=未執行。任一 U 或重大違失即不通過（非百分制）。
 *
 * 本模組為純函式分析：輸入一帧帧飛行樣本（由 ExamApp 自飛控 snapshot 記錄），
 * 不依賴 DOM/Three.js，可單元測試。
 */

import type { ExamConfig } from './config';
import type { ExamField } from './field';
import { figure8PathDeviationM } from './field';

export type ExamRating = 'S' | 'U' | 'N';

/** 一筆飛行樣本（由 ExamFlightController.snapshot() 每幀記錄）。 */
export interface FlightSample {
  /** 模擬時間（秒）。 */
  t: number;
  /** 世界座標（公尺）。 */
  x: number;
  y: number;
  z: number;
  /** 航向角（度，0=機頭朝 −Z）。 */
  headingDeg: number;
  /** 水平速度（m/s）。 */
  speedMps: number;
  /** 垂直速度（m/s）。 */
  vy: number;
  /** 當前操作模式。 */
  mode: 'manual' | 'attitude' | 'position';
}

export interface JudgmentCheck {
  /** i18n 鍵（UI 對應 zhHant.exam.*）。 */
  key: string;
  passed: boolean;
  /** 供人工審閱的量測值（數字字串）。 */
  detail: string;
}

export interface SubjectJudgmentBase {
  rating: ExamRating;
  /** 是否已執行（起飛過）。未執行 → N。 */
  executed: boolean;
  checks: JudgmentCheck[];
  /** 未通過項的 i18n 鍵（供畫面列出）。 */
  failReasonKeys: string[];
  /** 原始量測（recordRawMeasurements）。 */
  raw: Record<string, unknown>;
}

export interface SubjectBResult extends SubjectJudgmentBase {
  raw: {
    takeoffHeightM: number | null;
    plateaus: Array<{ headingDeg: number; hoverSeconds: number; driftM: number; altitudeM: number }>;
    rotationDeltasDeg: number[];
    landingDeviationM: number | null;
  };
}

export interface SubjectCResult extends SubjectJudgmentBase {
  raw: {
    initialHoverSeconds: number;
    maxPathDeviationM: number;
    offPathExcursionCount: number;
    altitudeMinM: number;
    altitudeMaxM: number;
    longestPauseS: number;
    leftWinding: number;
    rightWinding: number;
    leftBeforeRight: boolean;
  };
}

// ---------------------------------------------------------------------------
// 通用輔助
// ---------------------------------------------------------------------------

/** 有號最小角差（a−b，落於 (−180,180]）。 */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 懸停「靜止」門檻。模擬假設（量測穩健度）。 */
const HOVER = {
  stillSpeedMps: 0.3,
  stillVyMps: 0.3,
  headingRateDegPerS: 6,
  minPlateauS: 0.5,
  airborneAltM: 0.15,
};

interface Plateau {
  headingDeg: number;
  startT: number;
  endT: number;
  durationS: number;
  meanX: number;
  meanZ: number;
  meanAltitudeM: number;
  samples: FlightSample[];
}

/** 偵測懸停平台（水平靜止 + 高度穩定 + 航向穩定）。 */
function detectHoverPlateaus(samples: FlightSample[]): Plateau[] {
  const plateaus: Plateau[] = [];
  let cur: FlightSample[] = [];

  const flush = (): void => {
    if (cur.length >= 2) {
      const dur = cur[cur.length - 1].t - cur[0].t;
      if (dur >= HOVER.minPlateauS) {
        const sinSum = cur.reduce((a, s) => a + Math.sin((s.headingDeg * Math.PI) / 180), 0);
        const cosSum = cur.reduce((a, s) => a + Math.cos((s.headingDeg * Math.PI) / 180), 0);
        plateaus.push({
          headingDeg: ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360,
          startT: cur[0].t,
          endT: cur[cur.length - 1].t,
          durationS: dur,
          meanX: cur.reduce((a, s) => a + s.x, 0) / cur.length,
          meanZ: cur.reduce((a, s) => a + s.z, 0) / cur.length,
          meanAltitudeM: median(cur.map((s) => s.y)),
          samples: cur,
        });
      }
    }
    cur = [];
  };

  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    let still = s.y > HOVER.airborneAltM && s.speedMps < HOVER.stillSpeedMps && Math.abs(s.vy) < HOVER.stillVyMps;
    if (still && i > 0) {
      const dt = Math.max(1e-3, s.t - samples[i - 1].t);
      const rate = Math.abs(angleDelta(s.headingDeg, samples[i - 1].headingDeg)) / dt;
      still = rate < HOVER.headingRateDegPerS;
    }
    if (still) cur.push(s);
    else flush();
  }
  flush();
  return plateaus;
}

function maxAltitude(samples: FlightSample[]): number {
  return samples.reduce((m, s) => Math.max(m, s.y), 0);
}

// ---------------------------------------------------------------------------
// 科目 B：定點起降及四面停懸（p162）
// ---------------------------------------------------------------------------

/** 期望航向序列：外(0) → 右(90) → 內(180) → 左(270) → 外(360)。 */
const SUBJECT_B_EXPECTED_HEADINGS = [0, 90, 180, 270, 360];
const SUBJECT_B_SIDE_LABELS = ['外', '右', '內', '左', '外'];

export function judgeSubjectB(samples: FlightSample[], config: ExamConfig, field: ExamField): SubjectBResult {
  const a = config.simAssist.subjectB;
  const checks: JudgmentCheck[] = [];
  const failReasonKeys: string[] = [];
  const executed = maxAltitude(samples) > 0.5;

  const emptyRaw: SubjectBResult['raw'] = {
    takeoffHeightM: null,
    plateaus: [],
    rotationDeltasDeg: [],
    landingDeviationM: null,
  };
  if (!executed) {
    return { rating: 'N', executed: false, checks, failReasonKeys: ['subjectB.notExecuted'], raw: emptyRaw };
  }

  const plateaus = detectHoverPlateaus(samples);

  // 降落偏差：最後一筆著地樣本（y≈0）的水平位置距 H。
  const landed = [...samples].reverse().find((s) => s.y <= 0.05);
  const landingDeviationM = landed ? Math.hypot(landed.x - field.landingPointH.position.x, landed.z - field.landingPointH.position.z) : null;

  const heightOk = (alt: number): boolean => Math.abs(alt - a.hoverHeightTargetM) <= a.hoverHeightToleranceM;

  // 逐一比對期望的五個懸停平台。
  SUBJECT_B_EXPECTED_HEADINGS.forEach((expected, idx) => {
    const p = plateaus[idx];
    const side = SUBJECT_B_SIDE_LABELS[idx];
    if (!p) {
      checks.push({ key: `subjectB.hover_${side}`, passed: false, detail: '—' });
      failReasonKeys.push('subjectB.missingHover');
      return;
    }
    const hOk = Math.abs(angleDelta(p.headingDeg, expected % 360)) <= a.headingStepToleranceDeg;
    const tOk = p.durationS >= a.hoverTimeRequiredS - a.hoverTimeToleranceS;
    const altOk = heightOk(p.meanAltitudeM);
    const drift = Math.hypot(p.meanX - field.landingPointH.position.x, p.meanZ - field.landingPointH.position.z);
    const driftOk = drift <= a.positionHoldDriftToleranceM;
    const passed = hOk && tOk && altOk && driftOk;
    checks.push({
      key: `subjectB.hover_${side}`,
      passed,
      detail: `航向 ${p.headingDeg.toFixed(0)}°／${p.durationS.toFixed(1)}s／高 ${p.meanAltitudeM.toFixed(2)}m／漂移 ${drift.toFixed(2)}m`,
    });
    if (!passed) failReasonKeys.push('subjectB.hoverFail');
  });

  // 轉向：相鄰平台間應為順時針 +90°（容差 ±10）。
  const rotationDeltasDeg: number[] = [];
  for (let i = 0; i + 1 < plateaus.length && i < SUBJECT_B_EXPECTED_HEADINGS.length - 1; i += 1) {
    const delta = angleDelta(plateaus[i + 1].headingDeg, plateaus[i].headingDeg);
    rotationDeltasDeg.push(delta);
    const ok = delta >= a.headingStepDeg - a.headingStepToleranceDeg && delta <= a.headingStepDeg + a.headingStepToleranceDeg;
    checks.push({ key: `subjectB.rotation_${SUBJECT_B_SIDE_LABELS[i + 1]}`, passed: ok, detail: `${delta.toFixed(0)}°` });
    if (!ok) failReasonKeys.push('subjectB.rotationFail');
  }

  // 降落：起落架不得超過標示範圍（H 外標 1.8m），S 要求落點偏差 ≤ 0.5m。
  const landWithinMarking = landingDeviationM !== null && landingDeviationM <= field.landingPointH.outerMarkingM;
  const landOk = landingDeviationM !== null && landingDeviationM <= a.landingPositionToleranceM;
  checks.push({
    key: 'subjectB.landing',
    passed: landOk,
    detail: landingDeviationM === null ? '—' : `偏差 ${landingDeviationM.toFixed(2)}m`,
  });
  if (!landWithinMarking) failReasonKeys.push('subjectB.landingExitMarking');
  else if (!landOk) failReasonKeys.push('subjectB.landingFail');

  const rating: ExamRating = checks.every((c) => c.passed) ? 'S' : 'U';
  const takeoffHeight = plateaus[0]?.meanAltitudeM ?? null;
  return {
    rating,
    executed: true,
    checks,
    failReasonKeys: [...new Set(failReasonKeys)],
    raw: {
      takeoffHeightM: takeoffHeight,
      plateaus: plateaus.map((p) => ({
        headingDeg: p.headingDeg,
        hoverSeconds: p.durationS,
        driftM: Math.hypot(p.meanX, p.meanZ),
        altitudeM: p.meanAltitudeM,
      })),
      rotationDeltasDeg,
      landingDeviationM,
    },
  };
}

// ---------------------------------------------------------------------------
// 科目 C：8字水平圓（p163）
// ---------------------------------------------------------------------------

/** 八字機動進場的包絡盒（略大於雙圓外接盒），盒外視為進出場中轉，不計偏差。 */
function maneuverBox(field: ExamField): { xmin: number; xmax: number; zmin: number; zmax: number } {
  const pad = 1.0;
  return {
    xmin: -field.figure8.radiusM - pad,
    xmax: field.figure8.radiusM + pad,
    zmin: field.figure8.center.z - field.figure8.radiusM - pad,
    zmax: field.figure8.center.z + field.figure8.radiusM + pad,
  };
}

/** 軌跡有號面積（shoelace，x/z 平面）；>0 為逆時針、<0 為順時針。 */
function signedArea(points: Array<{ x: number; z: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

export function judgeSubjectC(samples: FlightSample[], config: ExamConfig, field: ExamField): SubjectCResult {
  const c = config.simAssist.subjectC;
  const checks: JudgmentCheck[] = [];
  const failReasonKeys: string[] = [];
  const executed = maxAltitude(samples) > 0.5;

  const emptyRaw: SubjectCResult['raw'] = {
    initialHoverSeconds: 0,
    maxPathDeviationM: 0,
    offPathExcursionCount: 0,
    altitudeMinM: 0,
    altitudeMaxM: 0,
    longestPauseS: 0,
    leftWinding: 0,
    rightWinding: 0,
    leftBeforeRight: false,
  };
  if (!executed) {
    return { rating: 'N', executed: false, checks, failReasonKeys: ['subjectC.notExecuted'], raw: emptyRaw };
  }

  const box = maneuverBox(field);
  const dev = samples.map((s) => figure8PathDeviationM(field, s.x, s.z));

  // 初始懸停：起飛後第一個懸停平台。
  const plateaus = detectHoverPlateaus(samples);
  const initialHover = plateaus[0];
  const initialHoverSeconds = initialHover?.durationS ?? 0;
  const hoverSecondsMinC = config.subjects.C.params.hoverSecondsMin;
  const initialHoverOk =
    initialHover !== undefined &&
    initialHoverSeconds >= hoverSecondsMinC - 0.2 &&
    initialHover.meanAltitudeM >= 1 &&
    initialHover.meanAltitudeM <= 2;
  checks.push({
    key: 'subjectC.initialHover',
    passed: initialHoverOk,
    detail: initialHover ? `${initialHoverSeconds.toFixed(1)}s／高 ${initialHover.meanAltitudeM.toFixed(2)}m` : '—',
  });
  if (!initialHoverOk) failReasonKeys.push('subjectC.initialHoverFail');

  // 機動窗口：首次貼近路徑(dev≤1.0) 到 最後一次貼近路徑 之間。
  const onIdx = dev.map((d, i) => (d <= c.pathDeviationToleranceM ? i : -1)).filter((i) => i >= 0);
  if (onIdx.length < 2) {
    checks.push({ key: 'subjectC.path', passed: false, detail: '未貼近八字路徑' });
    failReasonKeys.push('subjectC.pathFail');
    return {
      rating: 'U',
      executed: true,
      checks,
      failReasonKeys: [...new Set(failReasonKeys)],
      raw: { ...emptyRaw, initialHoverSeconds },
    };
  }
  const first = onIdx[0];
  const last = onIdx[onIdx.length - 1];
  const window = samples.slice(first, last + 1);
  const windowDev = dev.slice(first, last + 1);

  // 路徑偏差：窗口內超出包絡盒者視為偏出（穿越盒內捷徑/外擴）。
  let maxPathDeviationM = 0;
  let offPathExcursionCount = 0;
  window.forEach((s, i) => {
    const inBox = s.x >= box.xmin && s.x <= box.xmax && s.z >= box.zmin && s.z <= box.zmax;
    if (inBox && windowDev[i] > c.pathDeviationToleranceM) {
      offPathExcursionCount += 1;
      maxPathDeviationM = Math.max(maxPathDeviationM, windowDev[i]);
    }
  });
  const pathOk = offPathExcursionCount === 0;
  checks.push({
    key: 'subjectC.path',
    passed: pathOk,
    detail: `盒內最大偏差 ${maxPathDeviationM.toFixed(2)}m／越界點 ${offPathExcursionCount}`,
  });
  if (!pathOk) failReasonKeys.push('subjectC.pathFail');

  // 高度：窗口內維持 1.5±0.5（即 [1.0, 2.0]）。
  const altMin = Math.min(...window.map((s) => s.y));
  const altMax = Math.max(...window.map((s) => s.y));
  const altOk = altMin >= c.altitudeTargetM - c.altitudeToleranceM && altMax <= c.altitudeTargetM + c.altitudeToleranceM;
  checks.push({ key: 'subjectC.altitude', passed: altOk, detail: `${altMin.toFixed(2)}–${altMax.toFixed(2)}m` });
  if (!altOk) failReasonKeys.push('subjectC.altitudeFail');

  // 等速／轉彎不得停頓：窗口內最長靜止時間 ≤ maxTurnPauseS。
  // 靜止判定以「速度與垂直速度皆近零」為準；以最後一個靜止樣本的時間結算，
  // 避免與下一個運動樣本共用時間戳（合成資料或稀疏取樣）導致量得 0。
  let longestPauseS = 0;
  let runStart = -1;
  let runLast = -1;
  window.forEach((s, i) => {
    const still = s.speedMps < 0.3 && Math.abs(s.vy) < 0.3;
    if (still) {
      if (runStart < 0) runStart = i;
      runLast = i;
    } else if (runStart >= 0) {
      longestPauseS = Math.max(longestPauseS, window[runLast].t - window[runStart].t);
      runStart = -1;
      runLast = -1;
    }
  });
  if (runStart >= 0) {
    longestPauseS = Math.max(longestPauseS, window[runLast].t - window[runStart].t);
  }
  const pauseOk = longestPauseS <= c.maxTurnPauseS;
  checks.push({ key: 'subjectC.speed', passed: pauseOk, detail: `最長停頓 ${longestPauseS.toFixed(2)}s` });
  if (!pauseOk) failReasonKeys.push('subjectC.pauseFail');

  // 方向：左圓逆時針（winding>0）、右圓順時針（winding<0），且左先右後。
  const leftPts: Array<{ x: number; z: number }> = [];
  const rightPts: Array<{ x: number; z: number }> = [];
  const leftTimes: number[] = [];
  const rightTimes: number[] = [];
  window.forEach((s) => {
    const dl = Math.hypot(s.x - field.figure8.leftCircle.center.x, s.z - field.figure8.leftCircle.center.z);
    const dr = Math.hypot(s.x - field.figure8.rightCircle.center.x, s.z - field.figure8.rightCircle.center.z);
    if (dl <= dr) {
      leftPts.push({ x: s.x, z: s.z });
      leftTimes.push(s.t);
    } else {
      rightPts.push({ x: s.x, z: s.z });
      rightTimes.push(s.t);
    }
  });
  const leftWinding = signedArea(leftPts);
  const rightWinding = signedArea(rightPts);
  const loopThreshold = 40; // ≈半圈面積，確認確有盤旋
  const leftOk = leftWinding > loopThreshold;
  const rightOk = rightWinding < -loopThreshold;
  const leftBeforeRight =
    leftTimes.length > 0 && rightTimes.length > 0 &&
    leftTimes.reduce((a, b) => a + b, 0) / leftTimes.length < rightTimes.reduce((a, b) => a + b, 0) / rightTimes.length;
  checks.push({
    key: 'subjectC.direction',
    passed: leftOk && rightOk && leftBeforeRight,
    detail: `左圈 ${leftWinding.toFixed(0)}／右圈 ${rightWinding.toFixed(0)}／${leftBeforeRight ? '左先' : '右先'}`,
  });
  if (!leftOk) failReasonKeys.push('subjectC.leftCircleFail');
  if (!rightOk) failReasonKeys.push('subjectC.rightCircleFail');
  if (!leftBeforeRight) failReasonKeys.push('subjectC.orderFail');

  const rating: ExamRating = checks.every((c2) => c2.passed) ? 'S' : 'U';
  return {
    rating,
    executed: true,
    checks,
    failReasonKeys: [...new Set(failReasonKeys)],
    raw: {
      initialHoverSeconds,
      maxPathDeviationM,
      offPathExcursionCount,
      altitudeMinM: altMin,
      altitudeMaxM: altMax,
      longestPauseS,
      leftWinding,
      rightWinding,
      leftBeforeRight,
    },
  };
}
