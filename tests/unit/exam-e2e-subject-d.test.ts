/**
 * 端到端驗證：科目 D（側面停懸及前進、後退，p164）由腳本化理想操作真的飛完。
 *
 * 與 exam-e2e-scripted.test.ts 同一套執行框架（ScriptedPilot → ExamFlightController
 * 積分 → judgeSubjectD），不在這裡另造飛行器或合成軌跡。
 *
 * 情境（各在風 0 與風 5 m/s 下各跑一次）：
 *   D-ideal      理想操作：左側面 P3→P7→H、右側面 P7→P3→H，各定點懸停 6s
 *   D-hover3s    不良：其中一個定點只懸停 3s（< 4.8s 容差）
 *   D-wrongdir   不良：右側面那一輪的前進/後退搞反（先到 P3 才到 P7）
 *   D-short      不良：後退只走到兩圓中點就折返（未覆蓋 12m 後退距離）
 */

import { describe, expect, it } from 'vitest';
import { loadExamAircraftParams, loadExamConfig, loadExamLevelInfo } from '../../src/exam/config';
import { buildExamField, subjectDWaypoints } from '../../src/exam/field';
import { ExamFlightController } from '../../src/exam/flight-controller';
import { WindField } from '../../src/exam/wind';
import { toFlightSample } from '../../src/exam/exam-app';
import { angleDelta, type FlightSample } from '../../src/exam/subjects';
import { judgeSubjectD, type SubjectDResult } from '../../src/exam/subject-d';
import { detectMajorFailures, type MajorFailureReport } from '../../src/exam/major-failures';
import { ScriptedPilot, type PilotPathHeading, type PilotPoint } from '../../src/exam/scripted-pilot';
import { linePoints, subjectDSteps } from '../../src/exam/scripted-programs';
import type { ExamConfig } from '../../src/exam/config';
import type { ExamField } from '../../src/exam/field';
import type { ExamFlightSnapshot } from '../../src/exam/types';

const DT = 1 / 60;
/** 科目D 全程約 95s，留一倍餘量。 */
const MAX_RUN_S = 150;
const HOVER_ALT_M = 1.5;
const PATH_SPEED_MPS = 3;
/** 每個定點懸停秒數（> 5s 含容差 4.8s）。 */
const HOLD_S = 7;

interface Frame {
  dt: number;
  t: number;
  snap: ExamFlightSnapshot;
}

type Script = Generator<void, void, Frame>;

interface Ctx {
  pilot: ScriptedPilot;
  controller: ExamFlightController;
  field: ExamField;
}

interface Outcome {
  name: string;
  windMps: number;
  durationS: number;
  sampleCount: number;
  landed: boolean;
  d: SubjectDResult;
  mf: MajorFailureReport;
  config: ExamConfig;
  field: ExamField;
}

function* wait(seconds: number): Script {
  let elapsed = 0;
  while (elapsed < seconds) {
    const f = yield;
    elapsed += f.dt;
  }
}

function* waitUntil(pred: (f: Frame) => boolean, timeoutS: number): Script {
  let elapsed = 0;
  while (elapsed < timeoutS) {
    const f = yield;
    elapsed += f.dt;
    if (pred(f)) return;
  }
}

function* takeoffAndStabilize(ctx: Ctx, altM = HOVER_ALT_M): Script {
  ctx.controller.arm();
  ctx.controller.takeoff(altM);
  ctx.pilot.hold({ x: 0, z: 0 }, 0, altM);
  yield* waitUntil((f) => f.snap.position.y >= altM - 0.05, 5);
  yield* wait(1.0);
}

function* landAndSettle(ctx: Ctx): Script {
  ctx.controller.land();
  yield* waitUntil((f) => f.snap.state === 'landed', 8);
  yield* wait(0.5);
}

/** 定點懸停 seconds 秒；先等轉向完成才計時（轉向時間不算懸停）。 */
function* holdFor(pilot: ScriptedPilot, point: PilotPoint, heading: number | null, altM: number, seconds: number): Script {
  pilot.hold(point, heading, altM);
  if (heading !== null) {
    yield* waitUntil((f) => Math.abs(angleDelta(heading, f.snap.headingDeg)) <= 0.6, 8);
  }
  yield* wait(seconds);
}

function* followPath(pilot: ScriptedPilot, points: PilotPoint[], heading: PilotPathHeading): Script {
  pilot.followPath(points, PATH_SPEED_MPS, HOVER_ALT_M, heading);
  while (pilot.progress < 1) yield;
}

const H: PilotPoint = { x: 0, z: 0 };

/** 科目D 理想操作。 */
function* subjectDIdeal(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  // 轉機頭朝左側面懸停（官方準則第 1 條；此轉向前懸停未規定秒數）。
  yield* holdFor(ctx.pilot, H, 270, HOVER_ALT_M, 2);
  let from: PilotPoint = H;
  for (const step of subjectDSteps(ctx.field)) {
    yield* followPath(ctx.pilot, linePoints(from, step.point, 0.25), step.headingDeg);
    from = step.point;
    yield* holdFor(ctx.pilot, step.point, step.headingDeg, HOVER_ALT_M, HOLD_S);
  }
  // 機頭朝外後降落（與科目B/C 一致，離開考場動作不計入 D 判定）。
  yield* holdFor(ctx.pilot, H, 0, HOVER_ALT_M, 2);
  yield* landAndSettle(ctx);
}

/** 科目D 不良①：右側面那一輪的第一個定點（P7）只懸停 3s。 */
function* subjectDHoverTooShort(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  yield* holdFor(ctx.pilot, H, 270, HOVER_ALT_M, 2);
  const steps = subjectDSteps(ctx.field);
  let from: PilotPoint = H;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    // 第 4 步（index 3）是右側面第一定點 P7@90。
    const seconds = i === 3 ? 3 : HOLD_S;
    yield* followPath(ctx.pilot, linePoints(from, step.point, 0.25), step.headingDeg);
    from = step.point;
    yield* holdFor(ctx.pilot, step.point, step.headingDeg, HOVER_ALT_M, seconds);
  }
  yield* holdFor(ctx.pilot, H, 0, HOVER_ALT_M, 2);
  yield* landAndSettle(ctx);
}

/** 科目D 不良②：右側面那一輪的前進/後退搞反（H→P3→P7→H）。 */
function* subjectDWrongDirection(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  yield* holdFor(ctx.pilot, H, 270, HOVER_ALT_M, 2);
  let from: PilotPoint = H;
  // 左側面一輪照官方走（P3→P7→H）。
  for (const step of subjectDSteps(ctx.field).slice(0, 3)) {
    yield* followPath(ctx.pilot, linePoints(from, step.point, 0.25), step.headingDeg);
    from = step.point;
    yield* holdFor(ctx.pilot, step.point, step.headingDeg, HOVER_ALT_M, HOLD_S);
  }
  // 右側面一輪故意反轉（H→P3→P7→H），機頭仍朝右。
  const w = subjectDWaypoints(ctx.field);
  const reversed = [
    { point: { x: w.p3.x, z: w.p3.z }, headingDeg: 90 },
    { point: { x: w.p7.x, z: w.p7.z }, headingDeg: 90 },
    { point: { x: w.h.x, z: w.h.z }, headingDeg: 90 },
  ];
  for (const step of reversed) {
    yield* followPath(ctx.pilot, linePoints(from, step.point, 0.25), step.headingDeg);
    from = step.point;
    yield* holdFor(ctx.pilot, step.point, step.headingDeg, HOVER_ALT_M, HOLD_S);
  }
  yield* holdFor(ctx.pilot, H, 0, HOVER_ALT_M, 2);
  yield* landAndSettle(ctx);
}

/** 科目D 不良③：後退只走到兩圓中點（P4）就折返，未覆蓋 12m 後退距離。 */
function* subjectDShortRetreat(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  yield* holdFor(ctx.pilot, H, 270, HOVER_ALT_M, 2);
  const w = subjectDWaypoints(ctx.field);
  const mid: PilotPoint = { x: (w.p3.x + w.p7.x) / 2, z: (w.p3.z + w.p7.z) / 2 };
  const steps = subjectDSteps(ctx.field);
  // 左側面：P3 → 中點 → H（後退只走一半）。
  const shortFirst = [steps[0], { point: mid, headingDeg: 270 }, steps[2]];
  let from: PilotPoint = H;
  for (const step of shortFirst) {
    yield* followPath(ctx.pilot, linePoints(from, step.point, 0.25), step.headingDeg);
    from = step.point;
    yield* holdFor(ctx.pilot, step.point, step.headingDeg, HOVER_ALT_M, HOLD_S);
  }
  // 右側面照官方走（P7→P3→H）。
  for (const step of steps.slice(3)) {
    yield* followPath(ctx.pilot, linePoints(from, step.point, 0.25), step.headingDeg);
    from = step.point;
    yield* holdFor(ctx.pilot, step.point, step.headingDeg, HOVER_ALT_M, HOLD_S);
  }
  yield* holdFor(ctx.pilot, H, 0, HOVER_ALT_M, 2);
  yield* landAndSettle(ctx);
}

function runScript(make: (ctx: Ctx) => Script, meanWindMps: number, name: string): Outcome {
  const config = loadExamConfig();
  const field = buildExamField(config);
  const aircraft = loadExamAircraftParams();
  const controller = new ExamFlightController(aircraft);
  const windField = new WindField(config, { meanWindMps, gustMps: 0 });
  const pilot = new ScriptedPilot({
    maxSpeedMps: aircraft.maxHorizontalSpeedMps,
    positionGain: 3,
    velocityDamping: 2.5,
  });
  const ctx: Ctx = { pilot, controller, field };
  const script = make(ctx);

  const samples: FlightSample[] = [];
  let snap = controller.snapshot();
  let t = 0;
  let done = false;
  while (!done && t < MAX_RUN_S) {
    const cmd = pilot.update(snap, DT);
    windField.step(DT);
    controller.applyWind(windField.currentVector());
    snap = controller.update(cmd, DT);
    samples.push(toFlightSample(snap, t));
    t += DT;
    done = script.next({ dt: DT, t, snap }).done === true;
  }

  const level = loadExamLevelInfo();
  return {
    name,
    windMps: meanWindMps,
    durationS: t,
    sampleCount: samples.length,
    landed: controller.snapshot().state === 'landed',
    d: judgeSubjectD(samples, config, field, {
      configRetreatDistanceM: level.retreatDistanceM,
      level: level.level,
    }),
    mf: detectMajorFailures(samples, field, {}, config.majorFailures.rule, config.majorFailures.page),
    config,
    field,
  };
}

function logOutcome(o: Outcome): void {
  const d = o.d;
  const lines: string[] = [];
  lines.push(`── ${o.name}｜風 ${o.windMps} m/s｜模擬 ${o.durationS.toFixed(1)}s／${o.sampleCount} 樣本｜著地 ${o.landed ? '是' : '否'}`);
  lines.push(
    `   科目D 判定 ${d.rating}${d.executed ? '' : '（未執行）'}` +
      `｜級距 ${d.raw.level}（官方後退 ${d.raw.configRetreatDistanceM ?? '—'}m／場地 P3↔P7 ${d.raw.retreatSpacingM.toFixed(2)}m／實測覆蓋 ${d.raw.retreatTravelM === null ? '—' : `${d.raw.retreatTravelM.toFixed(2)}m`}）`,
  );
  lines.push(
    `   定點：` +
      d.raw.waypoints
        .map(
          (w) =>
            `${w.id}@${w.headingDeg}° ${w.matched ? `${w.hoverSeconds.toFixed(2)}s/漂移${w.driftM.toFixed(3)}m/高${w.altitudeM.toFixed(2)}m/橫移${w.lateralTravelM === null ? '—' : `${w.lateralTravelM >= 0 ? '+' : ''}${w.lateralTravelM.toFixed(1)}m`}(${w.arrivalDirection === 'forward' ? '前進' : w.arrivalDirection === 'backward' ? '後退' : '—'})` : '未匹配'}`,
        )
        .join('、'),
  );
  lines.push(
    `   等高窗口 ${d.raw.altitudeMinM === null ? '—' : `${d.raw.altitudeMinM.toFixed(2)}–${d.raw.altitudeMaxM?.toFixed(2)}m`}` +
      `｜未通過 ${d.failReasonKeys.join(',') || '無'}`,
  );
  const detected = o.mf.items.filter((m) => m.detected);
  lines.push(`   重大違失 ${detected.length === 0 ? '無' : detected.map((m) => `${m.code}(${m.detail})`).join('、')}`);
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

interface Expectation {
  rating: 'S' | 'U';
  failKey?: string;
}

const SCENARIOS: Array<{ name: string; make: (ctx: Ctx) => Script; wind: number[]; expect: Expectation }> = [
  { name: 'D 理想操作', make: subjectDIdeal, wind: [0, 5], expect: { rating: 'S' } },
  { name: 'D 不良①懸停不足', make: subjectDHoverTooShort, wind: [0, 5], expect: { rating: 'U', failKey: 'subjectD.hoverFail' } },
  { name: 'D 不良②方向錯誤', make: subjectDWrongDirection, wind: [0, 5], expect: { rating: 'U', failKey: 'subjectD.directionFail' } },
  { name: 'D 不良③後退不足', make: subjectDShortRetreat, wind: [0, 5], expect: { rating: 'U', failKey: 'subjectD.retreatFail' } },
];

describe('端到端：科目 D 側面停懸及前進後退由腳本化操作真的飛完並評 S/U/N', () => {
  for (const sc of SCENARIOS) {
    for (const wind of sc.wind) {
      it(
        `${sc.name}（風 ${wind} m/s）→ ${sc.expect.rating}`,
        () => {
          const o = runScript(sc.make, wind, sc.name);
          logOutcome(o);
          expect(o.landed, '應完成降落').toBe(true);
          expect(o.d.rating).toBe(sc.expect.rating);
          if (sc.expect.failKey) expect(o.d.failReasonKeys).toContain(sc.expect.failKey);
          if (sc.expect.rating === 'S') expect(o.mf.hasAny).toBe(false);
        },
        90000,
      );
    }
  }
});
