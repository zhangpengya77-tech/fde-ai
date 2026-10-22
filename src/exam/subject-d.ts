/**
 * 科目 D 判定：側面停懸及前進、後退（AC 107-005D p164）。
 *
 * 官方準則（config.subjects.D.criteria，質性描述）：
 *   1. 轉機頭朝左側面懸停
 *   2. 側面前進至P3定點懸停；側面後退至P7定點懸停；側面前進至H定點懸停
 *   3. 定點等高轉機頭朝右側面懸停
 *   4. 側面前進至P7定點懸停；側面後退至P3定點懸停；側面前進至H定點懸停
 * 量化閾值一律取 simAssist.subjectD（模擬假設，非官方，可調）。
 *
 * 座標與方向約定（與全專案飛控一致，forward = −Z、right = +X）：
 *   - 「朝左側面」= 機頭朝 −X → heading 270°；「朝右側面」= 機頭朝 +X → heading 90°。
 *   - 「前進」= 沿機頭方向位移，「後退」= 反方向。故機頭朝左時前進為 Δx<0、
 *     後退為 Δx>0；機頭朝右時前進為 Δx>0、後退為 Δx<0。
 *   - P3 在左圓、P7 在右圓（場幾何見 field.subjectDWaypoints），P3↔P7 橫向
 *     間距即該級距之後退距離（級距 I = 12m）。
 *
 * 本模組為純函式分析：輸入飛行樣本，不依賴 DOM/Three.js，可單元測試。
 */

import type { ExamConfig } from './config';
import type { ExamField } from './field';
import { subjectDWaypoints } from './field';
import { angleDelta, detectHoverPlateaus, type FlightSample, type JudgmentCheck, type SubjectJudgmentBase } from './subjects';

export type ExamRatingD = 'S' | 'U' | 'N';

/** 到達某定點的方式（依機頭朝向解讀橫向位移方向）。 */
export type ArrivalDirection = 'forward' | 'backward';

interface SubjectDWaypointSpec {
  /** 角錐／起降點 ID。 */
  id: string;
  /** 期望機頭朝向（度）。 */
  headingDeg: number;
  /** 期望以何種方式到達（前進／後退）。 */
  arrival: ArrivalDirection;
  /** 機頭是否朝右（+X）。false = 朝左（−X）。 */
  noseRight: boolean;
}

/**
 * 六個「定點懸停」依官方順序：
 * 左側面一輪（P3→P7→H）→ 右側面一輪（P7→P3→H）。
 * 另有两个「轉機頭朝側面懸停」動作（在 H 原地轉向），由航向檢查涵蓋，
 * 不另定 5 秒平台（官方未對該轉向前懸停留秒數）。
 */
const SUBJECT_D_WAYPOINTS: SubjectDWaypointSpec[] = [
  { id: 'P3', headingDeg: 270, arrival: 'forward', noseRight: false },
  { id: 'P7', headingDeg: 270, arrival: 'backward', noseRight: false },
  { id: 'H', headingDeg: 270, arrival: 'forward', noseRight: false },
  { id: 'P7', headingDeg: 90, arrival: 'forward', noseRight: true },
  { id: 'P3', headingDeg: 90, arrival: 'backward', noseRight: true },
  { id: 'H', headingDeg: 90, arrival: 'forward', noseRight: true },
];

export interface SubjectDWaypointMeasurement {
  id: string;
  targetX: number;
  targetZ: number;
  headingDeg: number;
  /** 是否匹配到合規懸停平台。 */
  matched: boolean;
  hoverSeconds: number;
  /** 平台中心到目標點的距離（m）。 */
  driftM: number;
  altitudeM: number;
  /** 由上一點到本點的橫向（X）位移（m）；首點以出發位置為基準。 */
  lateralTravelM: number | null;
  /** 實際橫向位移方向（依機頭朝向解讀）。 */
  arrivalDirection: ArrivalDirection | null;
  /** 期望方向。 */
  expectedArrival: ArrivalDirection;
}

export interface SubjectDResult extends SubjectJudgmentBase {
  raw: {
    waypoints: SubjectDWaypointMeasurement[];
    /** 場幾何導出的 P3↔P7 間距（m）。 */
    retreatSpacingM: number;
    /** 官方該級距之後退距離（config.subjects.D.params.retreatDistanceByLevelM）。 */
    configRetreatDistanceM: number | null;
    /** 級距（exam-aircraft.json defaultLevel）。 */
    level: string;
    /** 機動窗口（首個匹配平台起點 → 最後匹配平台終點）高度範圍。 */
    altitudeMinM: number | null;
    altitudeMaxM: number | null;
    /** 兩輪橫向往返實際覆蓋的後退距離（m）。 */
    retreatTravelM: number | null;
  };
}

function maxAltitude(samples: FlightSample[]): number {
  return samples.reduce((m, s) => Math.max(m, s.y), 0);
}

/**
 * 科目 D 判定。
 *
 * 採「依序贪婪匹配」：官方動作有固定順序，故懸停平台必須按序出現；
 * 起飛時在 H 的初始懸停（機頭朝外 0°）不會被誤配到任何 Waypoint
 * （航向不符），兩輪之間在 H 的轉向亦因航向不穩定的間隙而自然斷開。
 */
export function judgeSubjectD(
  samples: FlightSample[],
  config: ExamConfig,
  field: ExamField,
  options: { configRetreatDistanceM?: number | null; level?: string } = {},
): SubjectDResult {
  const d = config.simAssist.subjectD;
  const checks: JudgmentCheck[] = [];
  const failReasonKeys: string[] = [];
  const executed = maxAltitude(samples) > 0.5;

  const wps = subjectDWaypoints(field);
  const configRetreat = options.configRetreatDistanceM ?? null;
  const level = options.level ?? config.level ?? 'I';

  const emptyRaw: SubjectDResult['raw'] = {
    waypoints: [],
    retreatSpacingM: wps.retreatSpacingM,
    configRetreatDistanceM: configRetreat,
    level,
    altitudeMinM: null,
    altitudeMaxM: null,
    retreatTravelM: null,
  };
  if (!executed) {
    return { rating: 'N', executed: false, checks, failReasonKeys: ['subjectD.notExecuted'], raw: emptyRaw };
  }

  const plateaus = detectHoverPlateaus(samples);
  const targetOf = (id: string): { x: number; z: number } =>
    id === 'P3' ? wps.p3 : id === 'P7' ? wps.p7 : wps.h;

  const measurements: SubjectDWaypointMeasurement[] = [];
  /** 內部用：每個 Waypoint 匹配到的平台索引（−1 = 未匹配），供等高窗口取樣。 */
  const matchedPlateauIdx: number[] = [];
  let cursor = 0;
  let prevX: number | null = null;
  /** 出發位置（首個 Waypoint 的「由」點）：首筆樣本位置。 */
  const originX = samples[0].x;

  SUBJECT_D_WAYPOINTS.forEach((spec, idx) => {
    const target = targetOf(spec.id);
    let matchedIdx = -1;
    for (let i = cursor; i < plateaus.length; i += 1) {
      const p = plateaus[i];
      const drift = Math.hypot(p.meanX - target.x, p.meanZ - target.z);
      const headingOk = Math.abs(angleDelta(p.headingDeg, spec.headingDeg)) <= d.sideHeadingToleranceDeg;
      if (drift <= d.positionHoldDriftToleranceM && headingOk) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx < 0) {
      matchedPlateauIdx.push(-1);
      measurements.push({
        id: spec.id,
        targetX: target.x,
        targetZ: target.z,
        headingDeg: spec.headingDeg,
        matched: false,
        hoverSeconds: 0,
        driftM: NaN,
        altitudeM: NaN,
        lateralTravelM: null,
        arrivalDirection: null,
        expectedArrival: spec.arrival,
      });
      checks.push({
        key: `subjectD.waypoint_${spec.id}_${spec.headingDeg}`,
        passed: false,
        detail: `未匹配到 ${spec.id}（機頭 ${spec.headingDeg}°）定點懸停`,
      });
      failReasonKeys.push('subjectD.missingHover');
      return;
    }

    const p = plateaus[matchedIdx];
    matchedPlateauIdx.push(matchedIdx);
    cursor = matchedIdx + 1;
    const fromX = prevX ?? originX;
    const dx = p.meanX - fromX;
    prevX = p.meanX;

    // 橫向位移方向：以機頭朝向解讀 Δx（前進＝沿機頭方向）。
    const actual: ArrivalDirection = spec.noseRight ? (dx >= 0 ? 'forward' : 'backward') : dx < 0 ? 'forward' : 'backward';
    const drift = Math.hypot(p.meanX - target.x, p.meanZ - target.z);
    const timeOk = p.durationS >= d.hoverTimeRequiredS - d.hoverTimeToleranceS;
    const altOk = Math.abs(p.meanAltitudeM - d.hoverHeightTargetM) <= d.hoverHeightToleranceM;
    const directionOk = idx === 0 || actual === spec.arrival;

    measurements.push({
      id: spec.id,
      targetX: target.x,
      targetZ: target.z,
      headingDeg: spec.headingDeg,
      matched: true,
      hoverSeconds: p.durationS,
      driftM: drift,
      altitudeM: p.meanAltitudeM,
      lateralTravelM: dx,
      arrivalDirection: actual,
      expectedArrival: spec.arrival,
    });

    const passed = timeOk && altOk && directionOk;
    checks.push({
      key: `subjectD.waypoint_${spec.id}_${spec.headingDeg}`,
      passed,
      detail: `${p.durationS.toFixed(1)}s／漂移 ${drift.toFixed(2)}m／高 ${p.meanAltitudeM.toFixed(2)}m／橫移 ${dx >= 0 ? '+' : ''}${dx.toFixed(1)}m(${actual === 'forward' ? '前進' : '後退'})`,
    });
    if (!timeOk) failReasonKeys.push('subjectD.hoverFail');
    if (!altOk) failReasonKeys.push('subjectD.altitudeFail');
    if (!directionOk) failReasonKeys.push('subjectD.directionFail');
  });

  // 後退距離：官方準則要求「側面後退至P7／至P3」。以「每一輪實際走過的橫向
  // （X）跨度」量測——只看匹配到的平台起訖點會被 0.5m 定位容差掩蓋，故改取
  // 該輪窗口內所有樣本的 max(x)−min(x)：只走到兩圓中點就折返者跨度僅 6m。
  const roundWindow = (idxs: number[]): FlightSample[] => {
    const valid = idxs.map((i) => matchedPlateauIdx[i]).filter((i) => i >= 0) as number[];
    if (valid.length === 0) return [];
    const t0 = plateaus[Math.min(...valid)].startT;
    const t1 = plateaus[Math.max(...valid)].endT;
    return samples.filter((s) => s.t >= t0 && s.t <= t1);
  };
  const rounds = [
    { label: '第一輪', window: roundWindow([0, 1, 2]) },
    { label: '第二輪', window: roundWindow([3, 4, 5]) },
  ];
  const levelMismatch =
    configRetreat !== null && Math.abs(configRetreat - wps.retreatSpacingM) > d.retreatDistanceToleranceM;
  const roundReports = rounds.map((r) => {
    if (r.window.length === 0) return { label: r.label, spanM: null };
    const spanM = Math.max(...r.window.map((s) => s.x)) - Math.min(...r.window.map((s) => s.x));
    return { label: r.label, spanM };
  });
  const retreatTravelM = roundReports.every((r) => r.spanM !== null)
    ? Math.min(...(roundReports.map((r) => r.spanM) as number[]))
    : null;
  const retreatOk =
    roundReports.every((r) => r.spanM !== null) &&
    roundReports.every((r) => (r.spanM as number) >= wps.retreatSpacingM - d.retreatDistanceToleranceM);
  checks.push({
    key: 'subjectD.retreatDistance',
    passed: retreatOk,
    detail:
      roundReports.map((r) => `${r.label}橫向跨度 ${r.spanM === null ? '—' : `${r.spanM.toFixed(2)}m`}`).join('／') +
      `（場地 P3↔P7 間距 ${wps.retreatSpacingM.toFixed(2)}m` +
      `${levelMismatch ? `；官方級距 ${configRetreat}m 與場地（級距 ${level}）不符，見 nullsReport` : ''}）`,
  });
  if (!retreatOk) failReasonKeys.push('subjectD.retreatFail');

  // 定點等高：機動窗口（首個匹配平台起點 → 最後匹配平台終點）高度維持在目標帶內。
  const validIdx = matchedPlateauIdx.filter((i) => i >= 0);
  let altitudeMinM: number | null = null;
  let altitudeMaxM: number | null = null;
  if (validIdx.length >= 2) {
    const t0 = plateaus[Math.min(...validIdx)].startT;
    const t1 = plateaus[Math.max(...validIdx)].endT;
    const window = samples.filter((s) => s.t >= t0 && s.t <= t1);
    if (window.length > 0) {
      altitudeMinM = Math.min(...window.map((s) => s.y));
      altitudeMaxM = Math.max(...window.map((s) => s.y));
    }
  }
  const equalAltOk =
    altitudeMinM !== null &&
    altitudeMaxM !== null &&
    altitudeMinM >= d.hoverHeightTargetM - d.hoverHeightToleranceM &&
    altitudeMaxM <= d.hoverHeightTargetM + d.hoverHeightToleranceM;
  checks.push({
    key: 'subjectD.equalAltitude',
    passed: equalAltOk,
    detail:
      altitudeMinM === null || altitudeMaxM === null
        ? '—'
        : `${altitudeMinM.toFixed(2)}–${altitudeMaxM.toFixed(2)}m（目標 ${d.hoverHeightTargetM}±${d.hoverHeightToleranceM}m）`,
  });
  if (!equalAltOk) failReasonKeys.push('subjectD.altitudeSpreadFail');

  const rating: ExamRatingD = checks.every((c) => c.passed) ? 'S' : 'U';
  return {
    rating,
    executed: true,
    checks,
    failReasonKeys: [...new Set(failReasonKeys)],
    raw: {
      waypoints: measurements,
      retreatSpacingM: wps.retreatSpacingM,
      configRetreatDistanceM: configRetreat,
      level,
      altitudeMinM,
      altitudeMaxM,
      retreatTravelM,
    },
  };
}
