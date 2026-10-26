/**
 * 科目 E（高度保持五邊飛行）教學訓練層（第四輪）— 狀態機 + 航線/高度偵測 + 練習記錄。
 *
 * 定位（架構師第四輪指令）：
 *  - 獨立於正式考試評分的「練習狀態機」：READY → TAKEOFF → ENTER_ROUTE →
 *    SEGMENT_1…SEGMENT_5 → COMPLETE，另含 PAUSED（暫停覆疊）、RESTARTED
 *    （重新開始事件，回 READY）、ABORTED（中止終態）；
 *  - 偵測與記錄皆為純函式／純資料（不依賴 DOM／Three.js），便於自動化測試；
 *  - **不接正式評分**：無 S/U/N、不呼叫 subjects.ts／scoring.ts、不產生成績單；
 *  - 教學容差來自 config.simAssist.subjectE（模擬假設，非官方，可調），
 *    與官方 params 嚴格分離；
 *  - 航線幾何沿用 penta.ts 教學假設航線（assumption=true 恆真）。
 */

import type { FieldPoint2D } from './field';
import type { PentaRoute } from './penta';

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

/** 練習階段（phase）。PAUSED 為 paused 覆疊旗標；RESTARTED 為轉換日誌事件。 */
export type PentaTrainingPhase =
  | 'READY'
  | 'TAKEOFF'
  | 'ENTER_ROUTE'
  | 'SEGMENT_1'
  | 'SEGMENT_2'
  | 'SEGMENT_3'
  | 'SEGMENT_4'
  | 'SEGMENT_5'
  | 'COMPLETE'
  | 'ABORTED';

/** 一次位置取樣（由呼叫端每幀從飛控快照轉入）。 */
export interface PentaTrainingSample {
  /** 樣本時間（秒；練習時間軸，与 session 無關）。 */
  t: number;
  x: number;
  y: number;
  z: number;
  headingDeg: number;
}

/** 一條航段的練習記錄（教學量測，非評分）。 */
export interface PentaSegmentRecord {
  /** route.legs 的索引（0=第一邊…4=第五邊）。 */
  legIndex: number;
  label: string;
  startedAtT: number;
  endedAtT: number | null;
  /** 段內最大高度偏差絕對值（m）。 */
  maxAltitudeDeviationM: number;
  /** 段內最大航線偏離（m）。 */
  maxRouteDeviationM: number;
  reached: boolean;
}

/** 轉換日誌事件種類。 */
export type PentaTransitionEvent =
  | 'begin'
  | 'enter'
  | 'segment'
  | 'complete'
  | 'pause'
  | 'resume'
  | 'restart'
  | 'abort';

/** 一次狀態轉換紀錄（供練習記錄與除錯）。 */
export interface PentaTransitionLogEntry {
  t: number;
  event: PentaTransitionEvent;
  from: PentaTrainingPhase | null;
  to: PentaTrainingPhase;
  detail?: string;
}

/** 教學練習狀態（不可變資料；所有轉換回傳新物件，無效轉換回傳同一參考）。 */
export interface PentaTrainingState {
  phase: PentaTrainingPhase;
  paused: boolean;
  /** 暫停前所在 phase（resume 用）。 */
  phaseBeforePause: PentaTrainingPhase | null;
  segments: PentaSegmentRecord[];
  /** 已到達的航路點 index（去重，依到達順序）。 */
  reachedWaypoints: number[];
  startedAtT: number | null;
  endedAtT: number | null;
  abortReason: string | null;
  restartCount: number;
  maxAltitudeDeviationM: number;
  maxRouteDeviationM: number;
  transitions: PentaTransitionLogEntry[];
}

/** 教學容差（模擬假設，非官方；來源 config.simAssist.subjectE）。 */
export interface PentaTrainingTolerances {
  routeDeviationToleranceM: number;
  altitudeToleranceM: number;
  waypointReachRadiusM: number;
  minSegmentTimeS: number;
  takeoffCompleteToleranceM: number;
}

/**
 * 預設教學容差（與 config/caa-exam.json simAssist.subjectE 一致；
 * 由單元測試雙邊鎖定，防止紙本配置與程式預設分歧）。
 */
export const DEFAULT_PENTA_TEACHING_TOLERANCES: PentaTrainingTolerances = {
  routeDeviationToleranceM: 2.0,
  altitudeToleranceM: 1.0,
  waypointReachRadiusM: 2.0,
  minSegmentTimeS: 1.0,
  takeoffCompleteToleranceM: 0.5,
};

/** 點到線段的距離結果。 */
export interface PointSegmentDistance {
  distanceM: number;
  /** 投影在線段上的位置（0=起點、1=終點；外投影夾斷）。 */
  alongRatio: number;
  closest: FieldPoint2D;
}

/** 偵測目標：進入段或某一條邊。 */
export type PentaPositionTarget = { kind: 'entry' } | { kind: 'leg'; legIndex: number };

/** 一次位置偵測結果（純量測）。 */
export interface PentaSampleDetection {
  /** 到當前目標（進入段／航段）的垂直距離（m）。 */
  routeDeviationM: number;
  /** 高度偏差（實際 − 目標，m，帶符號）。 */
  altitudeDeviationM: number;
  /** 沿當前目標的進度 0..1。 */
  alongRatio: number;
  /** 到當前目標終點的直線距離（m）。 */
  distanceToTargetEndM: number;
  /** 當前目標上離取樣最近的點（供 3D 偏離連線）。 */
  closest: FieldPoint2D;
}

/** 教學視圖（UI 顯示用；由狀態 + 最後取樣推導）。 */
export interface PentaTrainingView {
  phase: PentaTrainingPhase;
  phaseLabel: string;
  paused: boolean;
  currentSegmentLabel: string | null;
  targetAltitudeM: number;
  actualAltitudeM: number | null;
  altitudeDeviationM: number | null;
  routeDeviationM: number | null;
  hint: string | null;
  canBegin: boolean;
  canPause: boolean;
  canResume: boolean;
  canRestart: boolean;
  canAbort: boolean;
}

/** 教學練習記錄（教師可查看；非官方成績）。 */
export interface PentaPracticeRecord {
  completed: boolean;
  aborted: boolean;
  startedAtT: number | null;
  endedAtT: number | null;
  durationS: number;
  segments: PentaSegmentRecord[];
  maxAltitudeDeviationM: number;
  maxRouteDeviationM: number;
  restartCount: number;
  abortReason: string | null;
  /** 恆 true：教學練習記錄，非官方成績。 */
  assumption: true;
  note: string;
}

/** 練習記錄的固定標語（畫面與記錄皆須標明非官方）。 */
export const PENTA_PRACTICE_NOTE =
  '教學練習記錄（非官方成績）：航線為教學假設、容差為模擬假設；不產生官方通過／失敗結論，不進入附錄5 成績單。';

const PHASE_LABELS: Record<PentaTrainingPhase, string> = {
  READY: '準備',
  TAKEOFF: '起飛',
  ENTER_ROUTE: '進入航線',
  SEGMENT_1: '第一邊',
  SEGMENT_2: '第二邊',
  SEGMENT_3: '第三邊',
  SEGMENT_4: '第四邊',
  SEGMENT_5: '第五邊',
  COMPLETE: '完成',
  ABORTED: '已中止',
};

// ---------------------------------------------------------------------------
// 狀態建立與轉換（純函式）
// ---------------------------------------------------------------------------

export function createPentaTrainingState(): PentaTrainingState {
  return {
    phase: 'READY',
    paused: false,
    phaseBeforePause: null,
    segments: [],
    reachedWaypoints: [],
    startedAtT: null,
    endedAtT: null,
    abortReason: null,
    restartCount: 0,
    maxAltitudeDeviationM: 0,
    maxRouteDeviationM: 0,
    transitions: [],
  };
}

function cloneState(s: PentaTrainingState): PentaTrainingState {
  return {
    ...s,
    segments: s.segments.map((r) => ({ ...r })),
    reachedWaypoints: [...s.reachedWaypoints],
    transitions: [...s.transitions],
  };
}

function pushTransition(
  s: PentaTrainingState,
  t: number,
  event: PentaTransitionEvent,
  from: PentaTrainingPhase | null,
  to: PentaTrainingPhase,
  detail?: string,
): void {
  s.transitions.push(detail === undefined ? { t, event, from, to } : { t, event, from, to, detail });
}

/** phase 是否為「活動中」（可暫停／中止／推進）。 */
export function pentaIsActivePhase(phase: PentaTrainingPhase): boolean {
  return phase === 'TAKEOFF' || phase === 'ENTER_ROUTE' || /^SEGMENT_[1-5]$/.test(phase);
}

/** phase 對應的目標航段（route.legs 索引）；非 SEGMENT_n 為 null。 */
export function targetLegIndexForPhase(phase: PentaTrainingPhase): number | null {
  const m = /^SEGMENT_([1-5])$/.exec(phase);
  return m ? Number(m[1]) - 1 : null;
}

/** 航段索引 → phase（0 → SEGMENT_1）。 */
export function phaseForLegIndex(legIndex: number): PentaTrainingPhase {
  return `SEGMENT_${legIndex + 1}` as PentaTrainingPhase;
}

/** 繁體中文階段標籤。 */
export function pentaPhaseLabel(phase: PentaTrainingPhase): string {
  return PHASE_LABELS[phase];
}

/** READY → TAKEOFF（僅 READY 有效；其餘回傳同一參考）。 */
export function pentaBegin(state: PentaTrainingState, t: number): PentaTrainingState {
  if (state.phase !== 'READY') return state;
  const s = cloneState(state);
  s.phase = 'TAKEOFF';
  s.startedAtT = t;
  pushTransition(s, t, 'begin', 'READY', 'TAKEOFF');
  return s;
}

/** 暫停（活動中且未暫停才有效）。 */
export function pentaPause(state: PentaTrainingState, t: number): PentaTrainingState {
  if (state.paused || !pentaIsActivePhase(state.phase)) return state;
  const s = cloneState(state);
  s.paused = true;
  s.phaseBeforePause = state.phase;
  pushTransition(s, t, 'pause', state.phase, state.phase, 'PAUSED');
  return s;
}

/** 恢復（暫停中才有效）。 */
export function pentaResume(state: PentaTrainingState, t: number): PentaTrainingState {
  if (!state.paused || state.phaseBeforePause === null) return state;
  const s = cloneState(state);
  // 自 state（已通過上方 null 檢查窄化）取值；cloneState 回傳新物件，
  // TS 不會把窄化套用到 s.phaseBeforePause。
  const from = state.phaseBeforePause;
  s.paused = false;
  s.phaseBeforePause = null;
  pushTransition(s, t, 'resume', from, from, 'RESUMED');
  return s;
}

/** 重新開始（RESTARTED）：回 READY、清空記錄、restartCount+1。READY 時無效。 */
export function pentaRestart(state: PentaTrainingState, t: number): PentaTrainingState {
  if (state.phase === 'READY') return state;
  const s = createPentaTrainingState();
  s.restartCount = state.restartCount + 1;
  pushTransition(s, t, 'restart', state.phase, 'READY', 'RESTARTED');
  return s;
}

/** 中止（ABORTED）：活動中才有效；未結束的航段記錄以當下時間收尾。 */
export function pentaAbort(state: PentaTrainingState, t: number, reason: string): PentaTrainingState {
  if (!pentaIsActivePhase(state.phase)) return state;
  const s = cloneState(state);
  for (const rec of s.segments) {
    if (rec.endedAtT === null) rec.endedAtT = t;
  }
  s.phase = 'ABORTED';
  s.abortReason = reason;
  s.endedAtT = t;
  s.paused = false;
  s.phaseBeforePause = null;
  pushTransition(s, t, 'abort', state.phase, 'ABORTED', reason);
  return s;
}

// ---------------------------------------------------------------------------
// 幾何偵測（純函式）
// ---------------------------------------------------------------------------

/** 點到線段的垂直距離（外投影夾斷到端點）。 */
export function distanceToSegmentM(a: FieldPoint2D, b: FieldPoint2D, x: number, z: number): PointSegmentDistance {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 <= 0) {
    return { distanceM: Math.hypot(x - a.x, z - a.z), alongRatio: 0, closest: { x: a.x, z: a.z } };
  }
  let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
  t = Math.min(1, Math.max(0, t));
  const cx = a.x + t * dx;
  const cz = a.z + t * dz;
  return { distanceM: Math.hypot(x - cx, z - cz), alongRatio: t, closest: { x: cx, z: cz } };
}

/** 目前 phase 的偵測目標（READY/TAKEOFF/COMPLETE/ABORTED 為 null）。 */
export function currentPentaTarget(state: PentaTrainingState): PentaPositionTarget | null {
  if (state.phase === 'ENTER_ROUTE') return { kind: 'entry' };
  const legIndex = targetLegIndexForPhase(state.phase);
  return legIndex === null ? null : { kind: 'leg', legIndex };
}

function targetEndpoints(route: PentaRoute, target: PentaPositionTarget): { a: FieldPoint2D; b: FieldPoint2D } {
  if (target.kind === 'entry') {
    return {
      a: route.waypoints[route.entry.fromIndex],
      b: route.waypoints[route.entry.toIndex],
    };
  }
  const leg = route.legs[target.legIndex];
  return { a: route.waypoints[leg.fromIndex], b: route.waypoints[leg.toIndex] };
}

/** 位置偵測：偏離量、高度偏差、進度與終點距離（純量測，無判定語意）。 */
export function detectPentaPosition(
  route: PentaRoute,
  sample: PentaTrainingSample,
  target: PentaPositionTarget,
): PentaSampleDetection {
  const { a, b } = targetEndpoints(route, target);
  const seg = distanceToSegmentM(a, b, sample.x, sample.z);
  return {
    routeDeviationM: seg.distanceM,
    altitudeDeviationM: sample.y - route.altitudeM,
    alongRatio: seg.alongRatio,
    distanceToTargetEndM: Math.hypot(sample.x - b.x, sample.z - b.z),
    closest: seg.closest,
  };
}

// ---------------------------------------------------------------------------
// 步驟推進（pentaStep）
// ---------------------------------------------------------------------------

function openSegmentRecord(
  route: PentaRoute,
  legIndex: number,
  t: number,
  d: PentaSampleDetection,
): PentaSegmentRecord {
  return {
    legIndex,
    label: route.legs[legIndex].label,
    startedAtT: t,
    endedAtT: null,
    maxAltitudeDeviationM: Math.abs(d.altitudeDeviationM),
    maxRouteDeviationM: d.routeDeviationM,
    reached: false,
  };
}

function addReachedWaypoint(s: PentaTrainingState, waypointIndex: number): void {
  if (!s.reachedWaypoints.includes(waypointIndex)) s.reachedWaypoints.push(waypointIndex);
}

/**
 * 每幀推進：依取樣位置驅動 phase 轉換並累積教學量測。
 *
 * 轉換條件（皆為教學假設門檻，非官方）：
 *  - TAKEOFF → ENTER_ROUTE：|實際高度 − 目標高度| ≤ takeoffCompleteToleranceM；
 *  - ENTER_ROUTE → SEGMENT_1：距進入段終點（W1）≤ waypointReachRadiusM；
 *  - SEGMENT_n → SEGMENT_{n+1}：距該邊終點 ≤ waypointReachRadiusM
 *    且已在段內停留 ≥ minSegmentTimeS（防止抄捷徑跳段）；
 *  - SEGMENT_5 → COMPLETE：距第五邊終點（W0 起降點）≤ waypointReachRadiusM
 *    且停留 ≥ minSegmentTimeS。
 *
 * 暫停中或非活動 phase：原樣回傳（同一參考）。
 */
export function pentaStep(
  state: PentaTrainingState,
  sample: PentaTrainingSample,
  route: PentaRoute,
  tolerances: PentaTrainingTolerances = DEFAULT_PENTA_TEACHING_TOLERANCES,
): PentaTrainingState {
  if (state.paused || !pentaIsActivePhase(state.phase)) return state;

  // 起飛段：只看高度是否進入容差（不累積偏差——爬升過程必然經過全部高度）。
  if (state.phase === 'TAKEOFF') {
    const altDev = sample.y - route.altitudeM;
    if (Math.abs(altDev) <= tolerances.takeoffCompleteToleranceM) {
      const s = cloneState(state);
      s.phase = 'ENTER_ROUTE';
      pushTransition(s, sample.t, 'enter', 'TAKEOFF', 'ENTER_ROUTE');
      return s;
    }
    return state;
  }

  const target = currentPentaTarget(state);
  if (!target) return state;
  const d = detectPentaPosition(route, sample, target);
  const s = cloneState(state);
  s.maxAltitudeDeviationM = Math.max(s.maxAltitudeDeviationM, Math.abs(d.altitudeDeviationM));
  s.maxRouteDeviationM = Math.max(s.maxRouteDeviationM, d.routeDeviationM);

  if (s.phase === 'ENTER_ROUTE') {
    if (d.distanceToTargetEndM <= tolerances.waypointReachRadiusM) {
      addReachedWaypoint(s, route.entry.toIndex);
      s.phase = 'SEGMENT_1';
      s.segments.push(openSegmentRecord(route, 0, sample.t, d));
      pushTransition(s, sample.t, 'segment', 'ENTER_ROUTE', 'SEGMENT_1', route.legs[0].label);
    }
    return s;
  }

  const legIndex = targetLegIndexForPhase(s.phase);
  if (legIndex === null) return s;
  const rec = s.segments[s.segments.length - 1];
  if (!rec || rec.legIndex !== legIndex) return s;
  rec.maxAltitudeDeviationM = Math.max(rec.maxAltitudeDeviationM, Math.abs(d.altitudeDeviationM));
  rec.maxRouteDeviationM = Math.max(rec.maxRouteDeviationM, d.routeDeviationM);

  const elapsedInSegment = sample.t - rec.startedAtT;
  const reachedEnd = d.distanceToTargetEndM <= tolerances.waypointReachRadiusM;
  if (!reachedEnd || elapsedInSegment < tolerances.minSegmentTimeS) return s;

  rec.endedAtT = sample.t;
  rec.reached = true;
  addReachedWaypoint(s, route.legs[legIndex].toIndex);

  if (legIndex < route.legs.length - 1) {
    const nextLeg = legIndex + 1;
    const dNext = detectPentaPosition(route, sample, { kind: 'leg', legIndex: nextLeg });
    s.maxAltitudeDeviationM = Math.max(s.maxAltitudeDeviationM, Math.abs(dNext.altitudeDeviationM));
    s.maxRouteDeviationM = Math.max(s.maxRouteDeviationM, dNext.routeDeviationM);
    s.segments.push(openSegmentRecord(route, nextLeg, sample.t, dNext));
    const from = s.phase;
    s.phase = phaseForLegIndex(nextLeg);
    pushTransition(s, sample.t, 'segment', from, s.phase, route.legs[nextLeg].label);
  } else {
    s.phase = 'COMPLETE';
    s.endedAtT = sample.t;
    pushTransition(s, sample.t, 'complete', 'SEGMENT_5', 'COMPLETE');
  }
  return s;
}

// ---------------------------------------------------------------------------
// 視圖與練習記錄
// ---------------------------------------------------------------------------

function buildHint(
  altitudeDeviationM: number | null,
  routeDeviationM: number | null,
  tolerances: PentaTrainingTolerances,
): string | null {
  const parts: string[] = [];
  if (altitudeDeviationM !== null && Math.abs(altitudeDeviationM) > tolerances.altitudeToleranceM) {
    const sign = altitudeDeviationM > 0 ? '+' : '−';
    parts.push(`高度偏差 ${sign}${Math.abs(altitudeDeviationM).toFixed(1)}m`);
  }
  if (routeDeviationM !== null && routeDeviationM > tolerances.routeDeviationToleranceM) {
    parts.push(`偏離教學航線 ${routeDeviationM.toFixed(1)}m`);
  }
  return parts.length > 0 ? parts.join('；') : null;
}

/** 由狀態與最後取樣推導 UI 視圖（純函式）。 */
export function pentaTrainingView(
  state: PentaTrainingState,
  route: PentaRoute,
  lastSample: PentaTrainingSample | null,
  tolerances: PentaTrainingTolerances = DEFAULT_PENTA_TEACHING_TOLERANCES,
): PentaTrainingView {
  const legIndex = targetLegIndexForPhase(state.phase);
  const currentSegmentLabel =
    state.phase === 'ENTER_ROUTE'
      ? route.entry.label
      : legIndex !== null
        ? route.legs[legIndex].label
        : state.phase === 'TAKEOFF'
          ? '起飛'
          : null;

  let actualAltitudeM: number | null = null;
  let altitudeDeviationM: number | null = null;
  let routeDeviationM: number | null = null;
  if (lastSample) {
    actualAltitudeM = lastSample.y;
    altitudeDeviationM = lastSample.y - route.altitudeM;
    const target = currentPentaTarget(state);
    if (target) routeDeviationM = detectPentaPosition(route, lastSample, target).routeDeviationM;
  }

  const baseLabel = pentaPhaseLabel(state.phase);
  return {
    phase: state.phase,
    phaseLabel: state.paused ? `${baseLabel}（已暫停）` : baseLabel,
    paused: state.paused,
    currentSegmentLabel,
    targetAltitudeM: route.altitudeM,
    actualAltitudeM,
    altitudeDeviationM,
    routeDeviationM,
    hint: buildHint(altitudeDeviationM, routeDeviationM, tolerances),
    canBegin: state.phase === 'READY',
    canPause: pentaIsActivePhase(state.phase) && !state.paused,
    canResume: state.paused,
    canRestart: state.phase !== 'READY',
    canAbort: pentaIsActivePhase(state.phase),
  };
}

/** 彙整教學練習記錄（恆標記 assumption=true 與非官方標語）。 */
export function buildPentaPracticeRecord(state: PentaTrainingState): PentaPracticeRecord {
  const durationS =
    state.startedAtT !== null && state.endedAtT !== null ? Math.max(0, state.endedAtT - state.startedAtT) : 0;
  return {
    completed: state.phase === 'COMPLETE',
    aborted: state.phase === 'ABORTED',
    startedAtT: state.startedAtT,
    endedAtT: state.endedAtT,
    durationS,
    segments: state.segments.map((r) => ({ ...r })),
    maxAltitudeDeviationM: state.maxAltitudeDeviationM,
    maxRouteDeviationM: state.maxRouteDeviationM,
    restartCount: state.restartCount,
    abortReason: state.abortReason,
    assumption: true,
    note: PENTA_PRACTICE_NOTE,
  };
}
