/**
 * 科目 F 判定 S/U/N（緊急處置程序，AC 107-005D p166，無人多旋翼機基本級）。
 *
 * 官方準則（p166，質性描述）：
 *   1. 應考人接獲監評人員指示後，口誦「3、2、1、Go」。
 *   2. 自起降點 H 上方約 1~2 公尺處，朝監評人員指示方向執行「高度保持五邊航線飛行」，
 *      機頭一律朝飛行方向，並待命執行手控返場緊急處置程序。
 *   3. 在空中任一位置，由監評人員下達「緊急返航」狀況。
 *   4. 應考人接獲緊急狀況後口誦「3、2、1、Go」並立即原處懸停，自行判斷當下高度、
 *      距離及進場航線後，以合理下滑角度實施穩定進場，降落時不得壓到標線或撞擊角錐，
 *      並隨時注意航機距離與高度變化，全程須穩定操控航機，儘速飛回相對較近一側八字
 *      內圈上方約 1~2 公尺處，調整下降率後，精準降落於較近一側八字內圈。
 *   5. 完成降落後，應考人口誦「結束」，靜候監評人員指示。
 *   ※以手動/姿態模式或定位模式（註記）執行。
 *
 * 模擬實作邊界（如實記錄，不臆造）：
 *   - F 由監評人員「在空中任一位置」觸發——模擬以 examiner 觸發事件（時間＋位置）
 *     記錄於 ExamSession；未觸發即未執行（N）。觸發前的五邊待命飛行屬科目 E 範疇
 *     （尚未實作），本科目不評判觸發前的航段。
 *   - 「立即原處懸停」的量化（immediateHoldWithinS，反應＋減速時限）、「合理下滑
 *     角度」（maxDescentRateMps）、「精準降落於內圈」（innerCircleToleranceM）、
 *     「撞擊角錐」（coneHitHeightM）皆取 simAssist.subjectF（模擬假設，非官方，可調）。
 *   - 「較近一側八字內圈」官方定義未讀到；模擬假設為「較近一側八字圓（半徑 6m）
 *     之圓內」，降落判定為圓心距 ≤ 半徑＋容差（見 nullsReport）。
 *
 * 本模組為純函式分析：輸入一帧帧飛行樣本與觸發事件，不依賴 DOM/Three.js。
 */

import type { ExamConfig } from './config';
import type { ExamField } from './field';
import { hitsAnyCone, nearerFigure8Circle } from './field';
import {
  detectHoverPlateaus,
  type ExamRating,
  type FlightSample,
  type JudgmentCheck,
  type SubjectJudgmentBase,
} from './subjects';

/** 懸停秒數容差（與科目 D 一致：實測 ≥ 需求 − 0.2s）。 */
const HOLD_TIME_TOLERANCE_S = 0.2;
/** 著地判定高度（y ≤ 此值視為觸地）。 */
const TOUCHDOWN_Y_M = 0.05;

/** 監評人員下達「緊急返航」的觸發事件（時間為樣本時間軸，位置為當下機位）。 */
export interface SubjectFTrigger {
  t: number;
  x: number;
  z: number;
}

export interface SubjectFResult extends SubjectJudgmentBase {
  raw: {
    triggerT: number | null;
    triggerX: number | null;
    triggerZ: number | null;
    /** 原處懸停平台起迄（觸發後）。 */
    holdStartT: number | null;
    holdSeconds: number;
    holdDriftM: number | null;
    /** 較近一側八字圓（降落目標）。 */
    circleSide: 'left' | 'right' | null;
    circleCenterX: number | null;
    circleCenterZ: number | null;
    /** 進場窗口內最小 vy（負值；取絕對值即最大下降率）。 */
    maxDescentRateMps: number;
    /** 首次進入目標圓上方時的高度。 */
    arrivalAltitudeM: number | null;
    /** 落點距目標圓心（m）。 */
    landingDistanceM: number | null;
    /** 進場/下降窗口內撞擊的角錐編號。 */
    coneHitIds: string[];
  };
}

function maxAltitude(samples: FlightSample[]): number {
  return samples.reduce((m, s) => Math.max(m, s.y), 0);
}

/**
 * 科目 F 判定。
 * @param samples 本科目切片（ExamSession 以 startSubject('F') 標記）
 * @param trigger 監評人員「緊急返航」觸發事件；null = 未觸發（未執行）
 */
export function judgeSubjectF(
  samples: FlightSample[],
  config: ExamConfig,
  field: ExamField,
  trigger: SubjectFTrigger | null,
): SubjectFResult {
  const f = config.simAssist.subjectF;
  const checks: JudgmentCheck[] = [];
  const failReasonKeys: string[] = [];
  const executed = maxAltitude(samples) > 0.5;

  const emptyRaw: SubjectFResult['raw'] = {
    triggerT: null,
    triggerX: null,
    triggerZ: null,
    holdStartT: null,
    holdSeconds: 0,
    holdDriftM: null,
    circleSide: null,
    circleCenterX: null,
    circleCenterZ: null,
    maxDescentRateMps: 0,
    arrivalAltitudeM: null,
    landingDistanceM: null,
    coneHitIds: [],
  };

  // F 由監評人員觸發；未下達「緊急返航」即未執行本科目程序。
  if (!trigger) {
    return {
      rating: 'N',
      executed,
      checks,
      failReasonKeys: ['subjectF.notTriggered'],
      raw: emptyRaw,
    };
  }

  const post = samples.filter((s) => s.t >= trigger.t);
  const raw: SubjectFResult['raw'] = {
    ...emptyRaw,
    triggerT: trigger.t,
    triggerX: trigger.x,
    triggerZ: trigger.z,
  };

  // 較近一側八字圓（以觸發當下位置判斷「相對較近一側」）。
  const near = nearerFigure8Circle(field, trigger.x, trigger.z);
  raw.circleSide = near.side;
  raw.circleCenterX = near.circle.center.x;
  raw.circleCenterZ = near.circle.center.z;
  const circle = near.circle;

  // ---- ① 立即原處懸停：觸發後 immediateHoldWithinS 內開始、位置在容許漂移內、
  //        持續 ≥ immediateHoldS（容差 0.2s）的懸停平台。 ----
  const hold = detectHoverPlateaus(post).find(
    (p) =>
      p.startT - trigger.t <= f.immediateHoldWithinS &&
      Math.hypot(p.meanX - trigger.x, p.meanZ - trigger.z) <= f.holdDriftToleranceM,
  );
  if (hold) {
    raw.holdStartT = hold.startT;
    raw.holdSeconds = hold.durationS;
    raw.holdDriftM = Math.hypot(hold.meanX - trigger.x, hold.meanZ - trigger.z);
  }
  const holdOk = hold !== undefined && hold.durationS >= f.immediateHoldS - HOLD_TIME_TOLERANCE_S;
  checks.push({
    key: 'subjectF.immediateHold',
    passed: holdOk,
    detail: hold
      ? `反應 ${(hold.startT - trigger.t).toFixed(2)}s／懸停 ${hold.durationS.toFixed(2)}s／漂移 ${(raw.holdDriftM ?? 0).toFixed(2)}m`
      : '未在原處懸停',
  });
  if (!holdOk) failReasonKeys.push('subjectF.immediateHoldFail');

  // ---- 進場窗口：原處懸停結束（未懸停則自觸發）至觸地。 ----
  const touchdown = post.find((s) => s.y <= TOUCHDOWN_Y_M) ?? null;
  const approachStartT = hold ? hold.endT : trigger.t;
  const approach = post.filter((s) => s.t >= approachStartT && (touchdown === null || s.t <= touchdown.t));

  // ---- ② 穩定進場：窗口內下降率不得超過 maxDescentRateMps（負值）。 ----
  const minVy = approach.reduce((m, s) => Math.min(m, s.vy), 0);
  raw.maxDescentRateMps = minVy;
  const descentOk = approach.length > 0 && minVy >= f.maxDescentRateMps;
  checks.push({
    key: 'subjectF.stableApproach',
    passed: descentOk,
    detail: approach.length > 0 ? `最大下降率 ${(-minVy).toFixed(2)} m/s（上限 ${(-f.maxDescentRateMps).toFixed(2)}）` : '—',
  });
  if (!descentOk) failReasonKeys.push('subjectF.stableApproachFail');

  // ---- ③ 飛回內圈上方約 1~2m：首次進入目標圓（圓心距 ≤ 半徑）時的高度。 ----
  const arrival = approach.find((s) => Math.hypot(s.x - circle.center.x, s.z - circle.center.z) <= circle.radiusM);
  raw.arrivalAltitudeM = arrival ? arrival.y : null;
  const arrivalOk =
    arrival !== undefined &&
    arrival.y >= f.approachAltitudeM[0] &&
    arrival.y <= f.approachAltitudeM[1];
  checks.push({
    key: 'subjectF.circleArrival',
    passed: arrivalOk,
    detail: arrival ? `進場高 ${arrival.y.toFixed(2)}m` : '未飛回內圈上方',
  });
  if (!arrivalOk) failReasonKeys.push('subjectF.circleArrivalFail');

  // ---- ④ 精準降落於內圈：落點圓心距 ≤ 半徑＋容差（模擬假設，見 nullsReport）。 ----
  const landingDist = touchdown
    ? Math.hypot(touchdown.x - circle.center.x, touchdown.z - circle.center.z)
    : null;
  raw.landingDistanceM = landingDist;
  const landOk = landingDist !== null && landingDist <= circle.radiusM + f.innerCircleToleranceM;
  checks.push({
    key: 'subjectF.landingPrecision',
    passed: landOk,
    detail: landingDist === null ? '未完成降落' : `落點距圓心 ${landingDist.toFixed(2)}m（內圈 ${circle.radiusM}m＋容差 ${f.innerCircleToleranceM}m）`,
  });
  if (!landOk) failReasonKeys.push('subjectF.landingFail');

  // ---- ⑤ 不得撞擊角錐：進場窗口內低於 coneHitHeightM 時不與任一角錐重疊。 ----
  const coneIds = new Set<string>();
  for (const s of approach) {
    if (s.y <= f.coneHitHeightM) {
      const id = hitsAnyCone(field, s.x, s.z);
      if (id) coneIds.add(id);
    }
  }
  raw.coneHitIds = [...coneIds];
  const coneOk = coneIds.size === 0;
  checks.push({
    key: 'subjectF.noConeHit',
    passed: coneOk,
    detail: coneIds.size > 0 ? `撞擊 ${[...coneIds].join('/')}` : '無',
  });
  if (!coneOk) failReasonKeys.push('subjectF.coneHitFail');

  const rating: ExamRating = checks.every((c) => c.passed) ? 'S' : 'U';
  return {
    rating,
    executed: true,
    checks,
    failReasonKeys: [...new Set(failReasonKeys)],
    raw,
  };
}
