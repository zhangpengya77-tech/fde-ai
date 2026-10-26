import { describe, expect, it } from 'vitest';
import { loadExamConfig } from '../../src/exam/config';
import { buildExamField } from '../../src/exam/field';
import { buildTeachingPentaRoute } from '../../src/exam/penta';
import {
  DEFAULT_PENTA_TEACHING_TOLERANCES,
  buildPentaPracticeRecord,
  createPentaTrainingState,
  detectPentaPosition,
  distanceToSegmentM,
  pentaAbort,
  pentaBegin,
  pentaIsActivePhase,
  pentaPause,
  pentaPhaseLabel,
  pentaResume,
  pentaRestart,
  pentaStep,
  pentaTrainingView,
  type PentaTrainingSample,
  type PentaTrainingTolerances,
} from '../../src/exam/penta-training';

const config = loadExamConfig();
const field = buildExamField(config);
const route = buildTeachingPentaRoute(field, config.subjects.E.params.operationAltitudeM);
const TOL: PentaTrainingTolerances = DEFAULT_PENTA_TEACHING_TOLERANCES;

function sample(t: number, x: number, y: number, z: number): PentaTrainingSample {
  return { t, x, y, z, headingDeg: 0 };
}

/** 便捷：從 READY 開始並完成起飛（TAKEOFF → ENTER_ROUTE）。 */
function beginAndTakeoff(t = 0): ReturnType<typeof createPentaTrainingState> {
  let s = pentaBegin(createPentaTrainingState(), t);
  s = pentaStep(s, sample(t + 1, 0, route.altitudeM, 0), route, TOL);
  return s;
}

// ---------------------------------------------------------------------------
// A. 教學狀態機（獨立於正式考試評分）
// ---------------------------------------------------------------------------

describe('科目 E 教學狀態機 — 轉換規則', () => {
  it('初始狀態為 READY（未開始、未暫停、無航段記錄）', () => {
    const s = createPentaTrainingState();
    expect(s.phase).toBe('READY');
    expect(s.paused).toBe(false);
    expect(s.segments).toHaveLength(0);
    expect(s.startedAtT).toBeNull();
    expect(s.restartCount).toBe(0);
  });

  it('begin：READY → TAKEOFF，記錄 startedAtT 與轉換日誌', () => {
    const s = pentaBegin(createPentaTrainingState(), 3);
    expect(s.phase).toBe('TAKEOFF');
    expect(s.startedAtT).toBe(3);
    expect(s.transitions.at(-1)).toMatchObject({ event: 'begin', from: 'READY', to: 'TAKEOFF', t: 3 });
  });

  it('非 READY 時 begin 無效（防止重複開始）', () => {
    const s = pentaBegin(pentaBegin(createPentaTrainingState(), 0), 1);
    expect(s.phase).toBe('TAKEOFF');
    expect(s.transitions).toHaveLength(1);
  });

  it('pause：活動中 → 暫停（保留 phaseBeforePause）', () => {
    const s = pentaPause(beginAndTakeoff(), 5);
    expect(s.paused).toBe(true);
    expect(s.phaseBeforePause).toBe('ENTER_ROUTE');
    expect(s.phase).toBe('ENTER_ROUTE');
    expect(s.transitions.at(-1)).toMatchObject({ event: 'pause', to: 'ENTER_ROUTE', t: 5 });
  });

  it('READY 暫停無效', () => {
    const s = pentaPause(createPentaTrainingState(), 1);
    expect(s.paused).toBe(false);
  });

  it('重複 pause 第二次無效', () => {
    const once = pentaPause(beginAndTakeoff(), 5);
    const twice = pentaPause(once, 6);
    expect(twice).toBe(once);
  });

  it('resume：恢復到暫停前 phase', () => {
    const s = pentaResume(pentaPause(beginAndTakeoff(), 5), 7);
    expect(s.paused).toBe(false);
    expect(s.phaseBeforePause).toBeNull();
    expect(s.phase).toBe('ENTER_ROUTE');
    expect(s.transitions.at(-1)).toMatchObject({ event: 'resume', from: 'ENTER_ROUTE', to: 'ENTER_ROUTE', t: 7 });
  });

  it('未暫停時 resume 無效', () => {
    const s = pentaResume(beginAndTakeoff(), 1);
    expect(s.paused).toBe(false);
  });

  it('restart：活動中 → READY，restartCount+1 且清空記錄', () => {
    let s = beginAndTakeoff();
    s = pentaStep(s, sample(2, -10, route.altitudeM, -22), route, TOL); // → SEGMENT_1
    expect(s.phase).toBe('SEGMENT_1');
    const r = pentaRestart(s, 9);
    expect(r.phase).toBe('READY');
    expect(r.restartCount).toBe(1);
    expect(r.segments).toHaveLength(0);
    expect(r.startedAtT).toBeNull();
    expect(r.maxAltitudeDeviationM).toBe(0);
    expect(r.transitions.at(-1)).toMatchObject({ event: 'restart', to: 'READY', t: 9 });
  });

  it('READY 時 restart 無效（restartCount 不增加）', () => {
    const r = pentaRestart(createPentaTrainingState(), 1);
    expect(r.phase).toBe('READY');
    expect(r.restartCount).toBe(0);
  });

  it('abort：活動中 → ABORTED，記錄原因與結束時間', () => {
    const s = pentaAbort(beginAndTakeoff(), 8, '機體降落');
    expect(s.phase).toBe('ABORTED');
    expect(s.abortReason).toBe('機體降落');
    expect(s.endedAtT).toBe(8);
    expect(s.transitions.at(-1)).toMatchObject({ event: 'abort', to: 'ABORTED', t: 8 });
  });

  it('COMPLETE 後 abort 無效', () => {
    let s = beginAndTakeoff();
    s = pentaAbort(s, 1, 'x');
    expect(s.phase).toBe('ABORTED');
    const again = pentaAbort(s, 2, 'y');
    expect(again).toBe(s);
  });

  it('轉換日誌記錄所有事件（RESTARTED 後記錄重置）', () => {
    let s = pentaBegin(createPentaTrainingState(), 0);
    s = pentaStep(s, sample(1, 0, route.altitudeM, 0), route, TOL);
    s = pentaPause(s, 2);
    s = pentaResume(s, 3);
    expect(s.transitions.map((e) => e.event)).toEqual(['begin', 'enter', 'pause', 'resume']);
    const r = pentaRestart(s, 4);
    // RESTARTED 重置練習（含轉換日誌），日誌僅保留 restart 事件本身。
    expect(r.transitions.map((e) => e.event)).toEqual(['restart']);
    expect(r.transitions[0].detail).toBe('RESTARTED');
  });

  it('pentaIsActivePhase 正確區分活動／非活動 phase', () => {
    expect(pentaIsActivePhase('READY')).toBe(false);
    expect(pentaIsActivePhase('TAKEOFF')).toBe(true);
    expect(pentaIsActivePhase('ENTER_ROUTE')).toBe(true);
    expect(pentaIsActivePhase('SEGMENT_3')).toBe(true);
    expect(pentaIsActivePhase('COMPLETE')).toBe(false);
    expect(pentaIsActivePhase('ABORTED')).toBe(false);
  });

  it('phase 標籤為繁體中文且涵蓋全部 phase', () => {
    expect(pentaPhaseLabel('READY')).toBe('準備');
    expect(pentaPhaseLabel('TAKEOFF')).toBe('起飛');
    expect(pentaPhaseLabel('ENTER_ROUTE')).toBe('進入航線');
    expect(pentaPhaseLabel('SEGMENT_1')).toBe('第一邊');
    expect(pentaPhaseLabel('SEGMENT_5')).toBe('第五邊');
    expect(pentaPhaseLabel('COMPLETE')).toBe('完成');
    expect(pentaPhaseLabel('ABORTED')).toBe('已中止');
  });
});

// ---------------------------------------------------------------------------
// B. 航段幾何與位置偵測（純函式）
// ---------------------------------------------------------------------------

describe('點到線段距離 — distanceToSegmentM', () => {
  it('線中點：距離 0、沿線比 0.5', () => {
    const r = distanceToSegmentM({ x: 0, z: 0 }, { x: 10, z: 0 }, 5, 0);
    expect(r.distanceM).toBeCloseTo(0, 6);
    expect(r.alongRatio).toBeCloseTo(0.5, 6);
    expect(r.closest).toEqual({ x: 5, z: 0 });
  });

  it('垂直距離', () => {
    const r = distanceToSegmentM({ x: 0, z: 0 }, { x: 10, z: 0 }, 5, 3);
    expect(r.distanceM).toBeCloseTo(3, 6);
    expect(r.alongRatio).toBeCloseTo(0.5, 6);
  });

  it('投影超出端點時夾斷到端點', () => {
    const before = distanceToSegmentM({ x: 0, z: 0 }, { x: 10, z: 0 }, -4, 0);
    expect(before.distanceM).toBeCloseTo(4, 6);
    expect(before.alongRatio).toBe(0);
    const after = distanceToSegmentM({ x: 0, z: 0 }, { x: 10, z: 0 }, 14, 0);
    expect(after.distanceM).toBeCloseTo(4, 6);
    expect(after.alongRatio).toBe(1);
  });
});

describe('位置偵測 — detectPentaPosition', () => {
  it('進入段：偏離量、進度與終點距離', () => {
    const d = detectPentaPosition(route, sample(0, -5, 20, -11), { kind: 'entry' });
    // 進入段 W0(0,0)→W1(-10,-22) 中點為 (-5,-11)。
    expect(d.routeDeviationM).toBeCloseTo(0, 6);
    expect(d.alongRatio).toBeGreaterThan(0.4);
    expect(d.alongRatio).toBeLessThan(0.6);
    expect(d.distanceToTargetEndM).toBeGreaterThan(10);
    expect(d.altitudeDeviationM).toBeCloseTo(0, 6);
  });

  it('航段：偏離量與終點距離（第二邊 W2→W3）', () => {
    const d = detectPentaPosition(route, sample(0, 10, 21.5, -14), { kind: 'leg', legIndex: 1 });
    expect(d.routeDeviationM).toBeCloseTo(0, 6);
    expect(d.altitudeDeviationM).toBeCloseTo(1.5, 6);
    expect(d.distanceToTargetEndM).toBeCloseTo(8, 6); // 距 W3(10,-6) 為 8m
  });

  it('高度偏差帶符號（低於目標為負）', () => {
    const d = detectPentaPosition(route, sample(0, 10, 18, -14), { kind: 'leg', legIndex: 1 });
    expect(d.altitudeDeviationM).toBeCloseTo(-2, 6);
  });

  it('航段外偏離：距第二邊 3m', () => {
    const d = detectPentaPosition(route, sample(0, 13, 20, -14), { kind: 'leg', legIndex: 1 });
    expect(d.routeDeviationM).toBeCloseTo(3, 6);
  });
});

// ---------------------------------------------------------------------------
// C. 教學步驟（pentaStep）：phase 推進與記錄
// ---------------------------------------------------------------------------

describe('教學步驟 — pentaStep', () => {
  it('TAKEOFF：到達目標高度容差內 → ENTER_ROUTE', () => {
    let s = pentaBegin(createPentaTrainingState(), 0);
    s = pentaStep(s, sample(1, 0, route.altitudeM - 0.3, 0), route, TOL);
    expect(s.phase).toBe('ENTER_ROUTE');
    expect(s.transitions.at(-1)).toMatchObject({ event: 'enter', to: 'ENTER_ROUTE' });
  });

  it('TAKEOFF：高度不足維持 TAKEOFF', () => {
    let s = pentaBegin(createPentaTrainingState(), 0);
    s = pentaStep(s, sample(1, 0, 5, 0), route, TOL);
    expect(s.phase).toBe('TAKEOFF');
  });

  it('ENTER_ROUTE：到達 W1 半徑內 → SEGMENT_1 並建立記錄', () => {
    const s = pentaStep(beginAndTakeoff(), sample(2, -10, route.altitudeM, -22), route, TOL);
    expect(s.phase).toBe('SEGMENT_1');
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toMatchObject({ legIndex: 0, label: '第一邊', startedAtT: 2, endedAtT: null, reached: false });
    expect(s.reachedWaypoints).toContain(1);
  });

  it('ENTER_ROUTE：遠離 W1 維持進入段', () => {
    const s = pentaStep(beginAndTakeoff(), sample(2, 0, route.altitudeM, 0), route, TOL);
    expect(s.phase).toBe('ENTER_ROUTE');
    expect(s.segments).toHaveLength(0);
  });

  it('SEGMENT_1 → SEGMENT_2：到達 W2 且超過最短段時', () => {
    let s = beginAndTakeoff();
    s = pentaStep(s, sample(2, -10, route.altitudeM, -22), route, TOL);
    s = pentaStep(s, sample(3.5, 10, route.altitudeM, -22), route, TOL);
    expect(s.phase).toBe('SEGMENT_2');
    expect(s.segments[0].reached).toBe(true);
    expect(s.segments[0].endedAtT).toBe(3.5);
    expect(s.segments).toHaveLength(2);
  });

  it('最短段時限未到不推進（防止抄捷徑）', () => {
    let s = beginAndTakeoff();
    s = pentaStep(s, sample(2, -10, route.altitudeM, -22), route, TOL);
    s = pentaStep(s, sample(2.5, 10, route.altitudeM, -22), route, TOL);
    expect(s.phase).toBe('SEGMENT_1');
    expect(s.segments[0].reached).toBe(false);
  });

  it('完整走完五段 → COMPLETE，五筆記錄皆 reached 且有結束時間', () => {
    let s = beginAndTakeoff();
    s = pentaStep(s, sample(2, -10, route.altitudeM, -22), route, TOL); // SEGMENT_1
    s = pentaStep(s, sample(2.5, 10, route.altitudeM, -22), route, TOL); // 時限未到
    s = pentaStep(s, sample(3.5, 10, route.altitudeM, -22), route, TOL); // SEGMENT_2
    s = pentaStep(s, sample(4.6, 10, route.altitudeM, -6), route, TOL); // SEGMENT_3
    s = pentaStep(s, sample(5.7, -10, route.altitudeM, -6), route, TOL); // SEGMENT_4
    s = pentaStep(s, sample(6.8, -10, route.altitudeM, -22), route, TOL); // SEGMENT_5
    s = pentaStep(s, sample(7.9, 0, route.altitudeM, 0), route, TOL); // COMPLETE
    expect(s.phase).toBe('COMPLETE');
    expect(s.segments).toHaveLength(5);
    for (const rec of s.segments) {
      expect(rec.reached).toBe(true);
      expect(rec.endedAtT).not.toBeNull();
    }
    expect(s.endedAtT).toBe(7.9);
    expect(s.reachedWaypoints).toEqual([1, 2, 3, 4, 0]);
    expect(s.transitions.at(-1)).toMatchObject({ event: 'complete', to: 'COMPLETE' });
  });

  it('暫停中 step 不推進', () => {
    let s = pentaPause(beginAndTakeoff(), 5);
    s = pentaStep(s, sample(6, -10, route.altitudeM, -22), route, TOL);
    expect(s.phase).toBe('ENTER_ROUTE');
    expect(s.segments).toHaveLength(0);
  });

  it('READY / COMPLETE / ABORTED 中 step 不推進', () => {
    expect(pentaStep(createPentaTrainingState(), sample(1, 0, 20, 0), route, TOL).phase).toBe('READY');
    let done = beginAndTakeoff();
    done = pentaAbort(done, 1, '測試');
    expect(pentaStep(done, sample(2, -10, route.altitudeM, -22), route, TOL).phase).toBe('ABORTED');
  });

  it('偏差最大值累積到狀態與航段記錄（進入段起算，起飛段不累積）', () => {
    let s = pentaBegin(createPentaTrainingState(), 0);
    s = pentaStep(s, sample(1, 0, 23, 0), route, TOL); // TAKEOFF：過高但不累積
    expect(s.maxAltitudeDeviationM).toBe(0);
    s = pentaStep(s, sample(2, 0, route.altitudeM, 0), route, TOL); // ENTER_ROUTE
    s = pentaStep(s, sample(3, -10, route.altitudeM + 1.5, -23.5), route, TOL); // SEGMENT_1 起點，偏高+偏離
    expect(s.phase).toBe('SEGMENT_1');
    expect(s.maxAltitudeDeviationM).toBeCloseTo(1.5, 6);
    expect(s.maxRouteDeviationM).toBeCloseTo(1.5, 6);
    expect(s.segments[0].maxAltitudeDeviationM).toBeCloseTo(1.5, 6);
    expect(s.segments[0].maxRouteDeviationM).toBeCloseTo(1.5, 6);
    s = pentaStep(s, sample(4, -10, route.altitudeM, -22), route, TOL); // 回到線上，最大值保留
    expect(s.maxAltitudeDeviationM).toBeCloseTo(1.5, 6);
    expect(s.maxRouteDeviationM).toBeCloseTo(1.5, 6);
  });
});

// ---------------------------------------------------------------------------
// D. 教學視圖與練習記錄（教師可查看；非官方成績）
// ---------------------------------------------------------------------------

describe('教學視圖 — pentaTrainingView', () => {
  it('READY：僅能開始，無實際高度', () => {
    const v = pentaTrainingView(createPentaTrainingState(), route, null);
    expect(v.phase).toBe('READY');
    expect(v.canBegin).toBe(true);
    expect(v.canPause).toBe(false);
    expect(v.actualAltitudeM).toBeNull();
    expect(v.altitudeDeviationM).toBeNull();
    expect(v.hint).toBeNull();
  });

  it('SEGMENT_2：顯示目前航段標籤、目標/實際高度與偏差', () => {
    let s = beginAndTakeoff();
    s = pentaStep(s, sample(2, -10, route.altitudeM, -22), route, TOL);
    s = pentaStep(s, sample(3.5, 10, route.altitudeM, -22), route, TOL);
    const v = pentaTrainingView(s, route, sample(4, 10, 21.4, -14));
    expect(v.phase).toBe('SEGMENT_2');
    expect(v.currentSegmentLabel).toBe('第二邊');
    expect(v.targetAltitudeM).toBe(route.altitudeM);
    expect(v.actualAltitudeM).toBeCloseTo(21.4, 6);
    expect(v.altitudeDeviationM).toBeCloseTo(1.4, 6);
  });

  it('暫停中：canResume=true 且 phaseLabel 標明暫停', () => {
    const s = pentaPause(beginAndTakeoff(), 5);
    const v = pentaTrainingView(s, route, null);
    expect(v.paused).toBe(true);
    expect(v.canResume).toBe(true);
    expect(v.canPause).toBe(false);
    expect(v.phaseLabel).toContain('暫停');
  });

  it('高度偏差超容差 → 提示「高度偏差」', () => {
    const s = beginAndTakeoff();
    const v = pentaTrainingView(s, route, sample(3, 0, 23, 0));
    expect(v.hint).toContain('高度偏差');
    expect(v.hint).toContain('+3.0');
  });

  it('偏離教學航線超容差 → 提示「偏離教學航線」', () => {
    const s = beginAndTakeoff();
    const v = pentaTrainingView(s, route, sample(3, 0, route.altitudeM, -8)); // 進入段中線為 x≈-3.6@z=-8，偏右約 3.6m
    expect(v.hint).toContain('偏離教學航線');
  });

  it('偏差在容差內 → 無提示', () => {
    const s = beginAndTakeoff();
    const v = pentaTrainingView(s, route, sample(3, -5, route.altitudeM, -11)); // 進入段中點
    expect(v.hint).toBeNull();
  });
});

describe('教學練習記錄 — buildPentaPracticeRecord', () => {
  function completeWalk(): ReturnType<typeof createPentaTrainingState> {
    let s = beginAndTakeoff();
    s = pentaStep(s, sample(2, -10, route.altitudeM, -22), route, TOL);
    s = pentaStep(s, sample(3.5, 10, route.altitudeM, -22), route, TOL);
    s = pentaStep(s, sample(4.6, 10, route.altitudeM, -6), route, TOL);
    s = pentaStep(s, sample(5.7, -10, route.altitudeM, -6), route, TOL);
    s = pentaStep(s, sample(6.8, -10, route.altitudeM, -22), route, TOL);
    s = pentaStep(s, sample(7.9, 0, route.altitudeM, 0), route, TOL);
    return s;
  }

  it('完成後：completed=true、五段齊全、durationS 正確', () => {
    const r = buildPentaPracticeRecord(completeWalk());
    expect(r.completed).toBe(true);
    expect(r.segments).toHaveLength(5);
    expect(r.durationS).toBeCloseTo(7.9, 6);
    expect(r.abortReason).toBeNull();
  });

  it('記錄恆標記 assumption=true 且 note 標明「教學練習記錄（非官方成績）」', () => {
    const r = buildPentaPracticeRecord(completeWalk());
    expect(r.assumption).toBe(true);
    expect(r.note).toContain('教學練習記錄');
    expect(r.note).toContain('非官方');
  });

  it('中止後：completed=false 且保留原因', () => {
    let s = beginAndTakeoff();
    s = pentaStep(s, sample(2, -10, route.altitudeM, -22), route, TOL);
    s = pentaAbort(s, 4, '機體降落');
    const r = buildPentaPracticeRecord(s);
    expect(r.completed).toBe(false);
    expect(r.aborted).toBe(true);
    expect(r.abortReason).toBe('機體降落');
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].reached).toBe(false);
  });

  it('未開始：completed=false、無段落、duration 0', () => {
    const r = buildPentaPracticeRecord(createPentaTrainingState());
    expect(r.completed).toBe(false);
    expect(r.segments).toHaveLength(0);
    expect(r.durationS).toBe(0);
    expect(r.startedAtT).toBeNull();
  });

  it('記錄 JSON 不含任何官方評分語彙（rating/score/pass）', () => {
    const json = JSON.stringify(buildPentaPracticeRecord(completeWalk()));
    expect(json).not.toMatch(/"rating"/);
    expect(json).not.toMatch(/"score"/);
    expect(json).not.toMatch(/"pass"/);
  });

  it('重新開始計數保留於記錄', () => {
    let s = beginAndTakeoff();
    s = pentaStep(s, sample(2, -10, route.altitudeM, -22), route, TOL);
    s = pentaRestart(s, 5);
    const r = buildPentaPracticeRecord(s);
    expect(r.restartCount).toBe(1);
    expect(r.completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E. 教學容差配置（獨立配置，不冒充官方）
// ---------------------------------------------------------------------------

describe('教學容差配置 — simAssist.subjectE（模擬假設，非官方）', () => {
  it('subjectE 教學參數存在且標記模擬假設', () => {
    const e = config.simAssist.subjectE;
    expect(e).toBeDefined();
    expect(e.assumption).toBe(true);
    expect(e.disclaimer).toContain('模擬假設');
    expect(e.note).toContain('非官方');
  });

  it('各門檻為正數', () => {
    const e = config.simAssist.subjectE;
    expect(e.routeDeviationToleranceM).toBeGreaterThan(0);
    expect(e.altitudeToleranceM).toBeGreaterThan(0);
    expect(e.waypointReachRadiusM).toBeGreaterThan(0);
    expect(e.minSegmentTimeS).toBeGreaterThan(0);
    expect(e.takeoffCompleteToleranceM).toBeGreaterThan(0);
  });

  it('預設容差與配置一致（DEFAULT_PENTA_TEACHING_TOLERANCES）', () => {
    const e = config.simAssist.subjectE;
    expect(DEFAULT_PENTA_TEACHING_TOLERANCES.routeDeviationToleranceM).toBe(e.routeDeviationToleranceM);
    expect(DEFAULT_PENTA_TEACHING_TOLERANCES.altitudeToleranceM).toBe(e.altitudeToleranceM);
    expect(DEFAULT_PENTA_TEACHING_TOLERANCES.waypointReachRadiusM).toBe(e.waypointReachRadiusM);
    expect(DEFAULT_PENTA_TEACHING_TOLERANCES.minSegmentTimeS).toBe(e.minSegmentTimeS);
    expect(DEFAULT_PENTA_TEACHING_TOLERANCES.takeoffCompleteToleranceM).toBe(e.takeoffCompleteToleranceM);
  });

  it('官方 params 不含容差欄位（教學容差不得冒充官方）', () => {
    const params = config.subjects.E.params as unknown as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(['minOperationAirspaceByLevelM', 'operationAltitudeM']);
  });

  it('教學航線仍恆標記 assumption=true', () => {
    expect(route.assumption).toBe(true);
  });
});
