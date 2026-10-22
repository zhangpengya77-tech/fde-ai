/**
 * 端到端驗證：科目 F（緊急處置程序，p166）由腳本化理想操作真的飛完。
 *
 * 與 exam-e2e-subject-d.test.ts 同一套執行框架（ScriptedPilot → ExamFlightController
 * 積分 → judgeSubjectF），不在這裡另造飛行器或合成軌跡。
 *
 * 官方流程（p166）：自 H 上方 1~2m 執行五邊航線待命 → 監評人員在空中任一位置
 * 下達「緊急返航」→ 立即原處懸停 → 以合理下滑角度穩定進場 → 飛回相對較近一側
 * 八字內圈上方 1~2m → 精準降落於內圈（不得壓標線／撞角錐）。
 *
 * 情境（各在風 0 與風 5 m/s 下各跑一次）：
 *   F-ideal      理想操作：觸發後原處懸停 4s → 飛回右內圈上方 1.5m → 1.0m/s 下降 → 圓心降落
 *   F-nohold     不良：接獲緊急返航後不懸停，直接飛去降落
 *   F-fastdesc   不良：進場下降率 2.5 m/s（> 1.5 上限）
 *   F-wrongcircle 不良：降落於 H（未落於較近一側內圈）
 */

import { describe, expect, it } from 'vitest';
import { loadExamAircraftParams, loadExamConfig } from '../../src/exam/config';
import { buildExamField, nearerFigure8Circle } from '../../src/exam/field';
import { ExamFlightController } from '../../src/exam/flight-controller';
import { WindField } from '../../src/exam/wind';
import { toFlightSample } from '../../src/exam/exam-app';
import type { FlightSample } from '../../src/exam/subjects';
import { judgeSubjectF, type SubjectFResult, type SubjectFTrigger } from '../../src/exam/subject-f';
import { detectMajorFailures, type MajorFailureReport } from '../../src/exam/major-failures';
import { ScriptedPilot, type PilotPathHeading, type PilotPoint } from '../../src/exam/scripted-pilot';
import { linePoints } from '../../src/exam/scripted-programs';
import type { ExamField } from '../../src/exam/field';
import type { ExamFlightSnapshot } from '../../src/exam/types';

const DT = 1 / 60;
/** 科目F 全程約 40s，留一倍餘量。 */
const MAX_RUN_S = 90;
const HOVER_ALT_M = 1.5;
const PATH_SPEED_MPS = 3;
/** 原處懸停秒數（> 3s 含容差 2.8s）。 */
const HOLD_S = 4;
/** 觸發點（五邊待命航段終點）；較近一側為右圓。 */
const TRIGGER_POINT: PilotPoint = { x: 8, z: -8 };

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
  f: SubjectFResult;
  mf: MajorFailureReport;
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

/** 定點懸停 seconds 秒（先等收斂）。 */
function* holdFor(pilot: ScriptedPilot, point: PilotPoint, heading: number | null, altM: number, seconds: number): Script {
  pilot.hold(point, heading, altM);
  yield* wait(seconds);
}

function* followPath(pilot: ScriptedPilot, points: PilotPoint[], heading: PilotPathHeading): Script {
  pilot.followPath(points, PATH_SPEED_MPS, HOVER_ALT_M, heading);
  while (pilot.progress < 1) yield;
  yield* wait(0.8);
}

/** 穩定控制下降（目標高度以 rateMps 遞減；實際下降率≈rate，避免超過上限）。 */
function* controlledDescent(
  ctx: Ctx,
  point: PilotPoint,
  heading: number | null,
  rateMps: number,
): Script {
  let target = HOVER_ALT_M;
  for (;;) {
    ctx.pilot.hold(point, heading, target);
    const f = yield;
    if (f.snap.position.y <= 0.06) break;
    target = Math.max(0.05, target - rateMps * f.dt);
  }
  // 觸地後由飛控降落流程收尾（自 0.06m 以 ≈0.12 m/s 著地，不影響下降率判定）。
  ctx.controller.land();
  yield* waitUntil((f) => f.snap.state === 'landed', 5);
  yield* wait(0.5);
}

/** 記錄當前帧為緊急返航觸發事件（監評人員下達時機）。 */
function* recordTrigger(trigger: { ref: SubjectFTrigger | null }): Script {
  const f = yield;
  trigger.ref = { t: f.t, x: f.snap.position.x, z: f.snap.position.z };
}

/** 科目F 理想操作。 */
function* subjectFIdeal(ctx: Ctx, trigger: { ref: SubjectFTrigger | null }): Script {
  yield* takeoffAndStabilize(ctx);
  // 五邊待命：H → (8,0) → 觸發點（機頭朝飛行方向）。
  yield* followPath(ctx.pilot, linePoints({ x: 0, z: 0 }, { x: 8, z: 0 }, 0.25), 'tangent');
  yield* followPath(ctx.pilot, linePoints({ x: 8, z: 0 }, TRIGGER_POINT, 0.25), 'tangent');
  // 監評人員下達「緊急返航」。
  yield* recordTrigger(trigger);
  // 立即原處懸停。
  yield* holdFor(ctx.pilot, TRIGGER_POINT, 0, HOVER_ALT_M, HOLD_S);
  // 飛回較近一側（右）內圈上方 1.5m。
  const right = ctx.field.figure8.rightCircle;
  yield* followPath(ctx.pilot, linePoints(TRIGGER_POINT, { x: right.center.x, z: right.center.z }, 0.25), 0);
  // 穩定進場降落於內圈（圓心）。
  yield* controlledDescent(ctx, { x: right.center.x, z: right.center.z }, 0, 1.0);
}

/** 科目F 不良①：接獲緊急返航後不原處懸停，直接飛去降落。 */
function* subjectFNoHold(ctx: Ctx, trigger: { ref: SubjectFTrigger | null }): Script {
  yield* takeoffAndStabilize(ctx);
  yield* followPath(ctx.pilot, linePoints({ x: 0, z: 0 }, { x: 8, z: 0 }, 0.25), 'tangent');
  yield* followPath(ctx.pilot, linePoints({ x: 8, z: 0 }, TRIGGER_POINT, 0.25), 'tangent');
  yield* recordTrigger(trigger);
  // 不懸停：立刻飛回內圈並降落。
  const right = ctx.field.figure8.rightCircle;
  yield* followPath(ctx.pilot, linePoints(TRIGGER_POINT, { x: right.center.x, z: right.center.z }, 0.25), 0);
  yield* controlledDescent(ctx, { x: right.center.x, z: right.center.z }, 0, 1.0);
}

/** 科目F 不良②：進場下降率 2.5 m/s（超過 1.5 上限）。 */
function* subjectFFastDescent(ctx: Ctx, trigger: { ref: SubjectFTrigger | null }): Script {
  yield* takeoffAndStabilize(ctx);
  yield* followPath(ctx.pilot, linePoints({ x: 0, z: 0 }, { x: 8, z: 0 }, 0.25), 'tangent');
  yield* followPath(ctx.pilot, linePoints({ x: 8, z: 0 }, TRIGGER_POINT, 0.25), 'tangent');
  yield* recordTrigger(trigger);
  yield* holdFor(ctx.pilot, TRIGGER_POINT, 0, HOVER_ALT_M, HOLD_S);
  const right = ctx.field.figure8.rightCircle;
  yield* followPath(ctx.pilot, linePoints(TRIGGER_POINT, { x: right.center.x, z: right.center.z }, 0.25), 0);
  yield* controlledDescent(ctx, { x: right.center.x, z: right.center.z }, 0, 2.5);
}

/** 科目F 不良③：飛回內圈上方後改降落於 H（未落於較近一側內圈）。 */
function* subjectFWrongCircle(ctx: Ctx, trigger: { ref: SubjectFTrigger | null }): Script {
  yield* takeoffAndStabilize(ctx);
  yield* followPath(ctx.pilot, linePoints({ x: 0, z: 0 }, { x: 8, z: 0 }, 0.25), 'tangent');
  yield* followPath(ctx.pilot, linePoints({ x: 8, z: 0 }, TRIGGER_POINT, 0.25), 'tangent');
  yield* recordTrigger(trigger);
  yield* holdFor(ctx.pilot, TRIGGER_POINT, 0, HOVER_ALT_M, HOLD_S);
  const right = ctx.field.figure8.rightCircle;
  yield* followPath(ctx.pilot, linePoints(TRIGGER_POINT, { x: right.center.x, z: right.center.z }, 0.25), 0);
  yield* followPath(ctx.pilot, linePoints({ x: right.center.x, z: right.center.z }, { x: 0, z: 0 }, 0.25), 0);
  yield* controlledDescent(ctx, { x: 0, z: 0 }, 0, 1.0);
}

function runScript(make: (ctx: Ctx, trigger: { ref: SubjectFTrigger | null }) => Script, meanWindMps: number, name: string): Outcome {
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
  const trigger: { ref: SubjectFTrigger | null } = { ref: null };
  const script = make(ctx, trigger);

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

  return {
    name,
    windMps: meanWindMps,
    durationS: t,
    sampleCount: samples.length,
    landed: controller.snapshot().state === 'landed',
    f: judgeSubjectF(samples, config, field, trigger.ref),
    mf: detectMajorFailures(samples, field, {}, config.majorFailures.rule, config.majorFailures.page),
  };
}

function logOutcome(o: Outcome): void {
  const f = o.f;
  const lines: string[] = [];
  lines.push(`── ${o.name}｜風 ${o.windMps} m/s｜模擬 ${o.durationS.toFixed(1)}s／${o.sampleCount} 樣本｜著地 ${o.landed ? '是' : '否'}`);
  lines.push(
    `   科目F 判定 ${f.rating}${f.executed ? '' : '（未執行）'}` +
      `｜觸發 t=${f.raw.triggerT?.toFixed(2) ?? '—'}s @ (${f.raw.triggerX?.toFixed(2) ?? '—'}, ${f.raw.triggerZ?.toFixed(2) ?? '—'})` +
      `｜較近一側 ${f.raw.circleSide ?? '—'} 圓`,
  );
  lines.push(
    `   原處懸停 ${f.raw.holdSeconds.toFixed(2)}s／漂移 ${f.raw.holdDriftM?.toFixed(3) ?? '—'}m` +
      `｜最大下降率 ${(-f.raw.maxDescentRateMps).toFixed(2)} m/s` +
      `｜進場高 ${f.raw.arrivalAltitudeM?.toFixed(2) ?? '—'}m` +
      `｜落點距圓心 ${f.raw.landingDistanceM?.toFixed(2) ?? '—'}m` +
      `｜撞錐 ${f.raw.coneHitIds.join('/') || '無'}`,
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

const SCENARIOS: Array<{ name: string; make: (ctx: Ctx, trigger: { ref: SubjectFTrigger | null }) => Script; wind: number[]; expect: Expectation }> = [
  { name: 'F 理想操作', make: subjectFIdeal, wind: [0, 5], expect: { rating: 'S' } },
  { name: 'F 不良①未原處懸停', make: subjectFNoHold, wind: [0, 5], expect: { rating: 'U', failKey: 'subjectF.immediateHoldFail' } },
  { name: 'F 不良②下降過快', make: subjectFFastDescent, wind: [0, 5], expect: { rating: 'U', failKey: 'subjectF.stableApproachFail' } },
  { name: 'F 不良③未落內圈', make: subjectFWrongCircle, wind: [0, 5], expect: { rating: 'U', failKey: 'subjectF.landingFail' } },
];

describe('端到端：科目 F 緊急處置程序由腳本化操作真的飛完並評 S/U/N', () => {
  for (const sc of SCENARIOS) {
    for (const wind of sc.wind) {
      it(
        `${sc.name}（風 ${wind} m/s）→ ${sc.expect.rating}`,
        () => {
          const o = runScript(sc.make, wind, sc.name);
          logOutcome(o);
          expect(o.landed, '應完成降落').toBe(true);
          expect(o.f.rating).toBe(sc.expect.rating);
          if (sc.expect.failKey) expect(o.f.failReasonKeys).toContain(sc.expect.failKey);
          if (sc.expect.rating === 'S') expect(o.mf.hasAny).toBe(false);
        },
        90000,
      );
    }
  }

  it('觸發點較近一側判定：右觸發 → 右圓、左觸發 → 左圓', () => {
    const field = buildExamField(loadExamConfig());
    expect(nearerFigure8Circle(field, 8, -8).side).toBe('right');
    expect(nearerFigure8Circle(field, -8, -8).side).toBe('left');
  });
});
