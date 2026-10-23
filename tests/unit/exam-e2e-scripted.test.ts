/**
 * 端到端驗證：腳本化「理想操作」＋「不良操作」真的送進考試機飛控。
 *
 * 這不是合成軌跡：每一帧由 ScriptedPilot 依「參考路徑 + 當前飛控快照」算出搖桿
 * 指令（roll/pitch/yaw/throttle），送進 ExamFlightController（含重型機慣性與
 * 風飄移），機體位置由飛控積分出來；錄下的 FlightSample 再交給與正式模式同一套
 * 的 judgeSubjectB / judgeSubjectC / detectMajorFailures 評 S/U/N。
 *
 * 六個情境（各在風 0 與風 5 m/s 下各跑一次，共 12 次）：
 *   B-ideal     科目B 理想操作（四面懸停各 6s、原地降落）
 *   B-hover3s   科目B 不良：其中一面只懸停 3s（< 4.8s）
 *   B-land-off  科目B 不良：降落點距 H 2.0m（超出 1.8m 外標示）
 *   C-ideal     科目C 理想操作（初始懸停 6s、八字機動、後退返航、原地降落）
 *   C-pause     科目C 不良：機動中途放桿停住 3.5s
 *   C-offpath   科目C 不良：左圈以 1.3 倍官方半徑（7.8m）繞行 → 偏離 6m 圓周 1.8m
 *
 * 量測值（懸停秒數、最大位置偏差、軌跡偏差、判定結果）由 console 印出，
 * 並以 expect 鎖住預期結果；任何一項不符即測試失敗，方便回歸。
 */

import { describe, expect, it } from 'vitest';
import { loadExamAircraftParams, loadExamConfig } from '../../src/exam/config';
import { buildExamField } from '../../src/exam/field';
import { ExamFlightController } from '../../src/exam/flight-controller';
import { WindField } from '../../src/exam/wind';
import { toFlightSample } from '../../src/exam/exam-app';
import { judgeSubjectB, judgeSubjectC, angleDelta, type FlightSample, type SubjectBResult, type SubjectCResult } from '../../src/exam/subjects';
import { detectMajorFailures, type MajorFailureReport } from '../../src/exam/major-failures';
import { ScriptedPilot, type PilotPathHeading, type PilotPoint } from '../../src/exam/scripted-pilot';
import { figure8Maneuver, returnToHome } from '../../src/exam/scripted-programs';
import type { ExamConfig } from '../../src/exam/config';
import type { ExamField } from '../../src/exam/field';
import type { ExamFlightSnapshot } from '../../src/exam/types';

// ---------------------------------------------------------------------------
// 執行框架
// ---------------------------------------------------------------------------

const DT = 1 / 60;
/** 單次模擬上限（秒）。科目C 全程約 45s，留一倍餘量。 */
const MAX_RUN_S = 120;
/** 懸停高度（科目B/C 官方準則 1~2m 取中值）。 */
const HOVER_ALT_M = 1.5;
/** 機動前進速度（m/s）。 */
const PATH_SPEED_MPS = 3;

interface Frame {
  dt: number;
  t: number;
  snap: ExamFlightSnapshot;
}

/** 腳本：每帧 yield 一次，可透過 yield 的值拿到該帧資訊。 */
type Script = Generator<void, void, Frame>;

interface Ctx {
  pilot: ScriptedPilot;
  controller: ExamFlightController;
  field: ExamField;
}

interface Outcome {
  name: string;
  windLabel: string;
  durationS: number;
  sampleCount: number;
  landed: boolean;
  b: SubjectBResult;
  c: SubjectCResult;
  mf: MajorFailureReport;
  config: ExamConfig;
  field: ExamField;
}

/** 等待 seconds 秒。 */
function* wait(seconds: number): Script {
  let elapsed = 0;
  while (elapsed < seconds) {
    const f = yield;
    elapsed += f.dt;
  }
}

/** 等待直到 pred(frame) 成立或逾時。 */
function* waitUntil(pred: (f: Frame) => boolean, timeoutS: number): Script {
  let elapsed = 0;
  while (elapsed < timeoutS) {
    const f = yield;
    elapsed += f.dt;
    if (pred(f)) return;
  }
}

/** 起飛到指定高度並穩定。 */
function* takeoffAndStabilize(ctx: Ctx, altM = HOVER_ALT_M): Script {
  ctx.controller.arm();
  ctx.controller.takeoff(altM);
  ctx.pilot.hold({ x: 0, z: 0 }, 0, altM);
  // 起飛爬升（≈1s）＋ 穩定；起飛分支期間飛控忽略水平指令。
  yield* waitUntil((f) => f.snap.position.y >= altM - 0.05, 5);
  yield* wait(1.0);
}

/** 降落並等待著地。 */
function* landAndSettle(ctx: Ctx): Script {
  ctx.controller.land();
  yield* waitUntil((f) => f.snap.state === 'landed', 8);
  yield* wait(0.5);
}

/**
 * 定點懸停 seconds 秒（指定航向）。
 *
 * 先等轉向完成才開始計時——官方準則是「順時針旋轉 90 度，定點懸停 5 秒」，
 * 轉向時間不屬於懸停時間；一邊轉一邊計會把懸停量測壓到 5s 以下而誤判 U。
 */
function* holdFor(pilot: ScriptedPilot, point: PilotPoint, heading: number | null, altM: number, seconds: number): Script {
  pilot.hold(point, heading, altM);
  if (heading !== null) {
    // 0.6° 略大於飛行員航向死區（0.5°），確保一定等得到。
    yield* waitUntil((f) => Math.abs(angleDelta(heading, f.snap.headingDeg)) <= 0.6, 8);
  }
  yield* wait(seconds);
}

/** 沿路徑飛行到結束（參考點推進完畢即切換，不在終點多等——避免無謂停頓）。 */
function* followPath(pilot: ScriptedPilot, points: PilotPoint[], heading: PilotPathHeading): Script {
  pilot.followPath(points, PATH_SPEED_MPS, HOVER_ALT_M, heading);
  while (pilot.progress < 1) yield;
}

// ---------------------------------------------------------------------------
// 六個情境
// ---------------------------------------------------------------------------

const H: PilotPoint = { x: 0, z: 0 };

/** 科目B 理想操作：四面懸停各 6s（> 5s 含容差 4.8s），原地降落。 */
function* subjectBIdeal(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  for (const heading of [0, 90, 180, 270, 0]) {
    yield* holdFor(ctx.pilot, H, heading, HOVER_ALT_M, 6);
  }
  yield* landAndSettle(ctx);
}

/** 科目B 不良①：機頭朝右（90°）那一面只懸停 3s。 */
function* subjectBHoverTooShort(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  yield* holdFor(ctx.pilot, H, 0, HOVER_ALT_M, 6);
  yield* holdFor(ctx.pilot, H, 90, HOVER_ALT_M, 3); // ← 不足 5s
  yield* holdFor(ctx.pilot, H, 180, HOVER_ALT_M, 6);
  yield* holdFor(ctx.pilot, H, 270, HOVER_ALT_M, 6);
  yield* holdFor(ctx.pilot, H, 0, HOVER_ALT_M, 6);
  yield* landAndSettle(ctx);
}

/** 科目B 不良②：五面懸停都正確，但最後飛到距 H 2.0m 處才降落（超出 1.8m 外標示）。 */
function* subjectBLandOutsideMarking(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  for (const heading of [0, 90, 180, 270, 0]) {
    yield* holdFor(ctx.pilot, H, heading, HOVER_ALT_M, 6);
  }
  // 平移至 (2.0, 0)：距 H 2.0m > 外標示 1.8m。
  yield* holdFor(ctx.pilot, { x: 2.0, z: 0 }, null, HOVER_ALT_M, 5);
  yield* landAndSettle(ctx);
}

/** 科目C 理想操作：初始定點懸停 6s → 八字機動（機頭朝飛行方向）→ 後退返航（機頭朝外）→ 降落。 */
function* subjectCIdeal(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  yield* holdFor(ctx.pilot, H, 0, HOVER_ALT_M, 6);
  yield* followPath(ctx.pilot, figure8Maneuver(ctx.field), 'tangent');
  yield* followPath(ctx.pilot, returnToHome(ctx.field), 0);
  yield* wait(2.0);
  yield* landAndSettle(ctx);
}

/** 科目C 不良①：機動進行到 35% 時放桿停住 5s（轉彎處停頓）。 */
function* subjectCPauseMidManeuver(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  yield* holdFor(ctx.pilot, H, 0, HOVER_ALT_M, 6);
  const maneuver = figure8Maneuver(ctx.field);
  ctx.pilot.followPath(maneuver, PATH_SPEED_MPS, HOVER_ALT_M, 'tangent');
  let paused = false;
  while (ctx.pilot.progress < 1) {
    if (!paused && ctx.pilot.progress >= 0.35) {
      ctx.pilot.pause(5);
      paused = true;
    }
    yield;
  }
  yield* followPath(ctx.pilot, returnToHome(ctx.field), 0);
  yield* wait(2.0);
  yield* landAndSettle(ctx);
}

/** 科目C 不良②：左圈以 1.3 倍官方半徑繞行（軌跡超出 12m 八字標示）。 */
function* subjectCOffPath(ctx: Ctx): Script {
  yield* takeoffAndStabilize(ctx);
  yield* holdFor(ctx.pilot, H, 0, HOVER_ALT_M, 6);
  yield* followPath(ctx.pilot, figure8Maneuver(ctx.field, { leftRadiusScale: 1.3 }), 'tangent');
  yield* followPath(ctx.pilot, returnToHome(ctx.field), 0);
  yield* wait(2.0);
  yield* landAndSettle(ctx);
}

// ---------------------------------------------------------------------------
// 風況矩陣（教師 2026-10-23 指定：無風與微風）
// ---------------------------------------------------------------------------

/** 風況：無風（0/0，預設）與微風（平均 2／陣峰 4，模擬假設非官方）。 */
const WIND_CASES = [
  { preset: 'calm', label: '無風 0/0' },
  { preset: 'breeze', label: '微風 2/4' },
] as const;

// ---------------------------------------------------------------------------
// 執行器
// ---------------------------------------------------------------------------

function runScript(make: (ctx: Ctx) => Script, preset: string, windLabel: string, name: string): Outcome {
  const config = loadExamConfig();
  const field = buildExamField(config);
  const aircraft = loadExamAircraftParams();
  const controller = new ExamFlightController(aircraft);
  // 風況由 windPresets 定義（陣峰＝瞬時上限）；無風時風場完全確定，量測可重現。
  const windField = new WindField(config, { preset });
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

  return {
    name,
    windLabel,
    durationS: t,
    sampleCount: samples.length,
    landed: controller.snapshot().state === 'landed',
    b: judgeSubjectB(samples, config, field),
    c: judgeSubjectC(samples, config, field),
    mf: detectMajorFailures(samples, field, {}, config.majorFailures.rule, config.majorFailures.page),
    config,
    field,
  };
}

// ---------------------------------------------------------------------------
// 量測輸出
// ---------------------------------------------------------------------------

function logOutcome(o: Outcome): void {
  const b = o.b;
  const c = o.c;
  const lines: string[] = [];
  lines.push(`── ${o.name}｜風況 ${o.windLabel}｜模擬 ${o.durationS.toFixed(1)}s／${o.sampleCount} 樣本｜著地 ${o.landed ? '是' : '否'}`);
  lines.push(
    `   科目B 判定 ${b.rating}${b.executed ? '' : '（未執行）'}` +
      `｜懸停平台 ${b.raw.plateaus.length} 面：` +
      b.raw.plateaus
        .map((p) => `${p.headingDeg.toFixed(0)}°/${p.hoverSeconds.toFixed(2)}s/漂移${p.driftM.toFixed(3)}m/高${p.altitudeM.toFixed(2)}m`)
        .join('、'),
  );
  lines.push(
    `   科目B 轉向 ${b.raw.rotationDeltasDeg.map((d) => `${d.toFixed(1)}°`).join(' → ') || '—'}` +
      `｜降落偏差 ${b.raw.landingDeviationM === null ? '—' : `${b.raw.landingDeviationM.toFixed(3)}m`}` +
      `｜未通過 ${b.failReasonKeys.join(',') || '無'}`,
  );
  lines.push(
    `   科目C 判定 ${c.rating}${c.executed ? '' : '（未執行）'}` +
      `｜初始懸停 ${c.raw.initialHoverSeconds.toFixed(2)}s` +
      `｜盒內最大軌跡偏差 ${c.raw.maxPathDeviationM.toFixed(3)}m（越界點 ${c.raw.offPathExcursionCount}）` +
      `｜高度 ${c.raw.altitudeMinM.toFixed(2)}–${c.raw.altitudeMaxM.toFixed(2)}m` +
      `｜最長停頓 ${c.raw.longestPauseS.toFixed(2)}s` +
      `｜左圈 ${c.raw.leftWinding.toFixed(0)}／右圈 ${c.raw.rightWinding.toFixed(0)}／${c.raw.leftBeforeRight ? '左先' : '右先'}` +
      `｜未通過 ${c.failReasonKeys.join(',') || '無'}`,
  );
  const detected = o.mf.items.filter((m) => m.detected);
  lines.push(`   重大違失 ${detected.length === 0 ? '無' : detected.map((m) => `${m.code}(${m.detail})`).join('、')}`);
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// 測試
// ---------------------------------------------------------------------------

interface Expectation {
  subject: 'b' | 'c';
  rating: 'S' | 'U';
  failKey?: string;
}

const SCENARIOS: Array<{ name: string; make: (ctx: Ctx) => Script; wind: typeof WIND_CASES; expect: Expectation }> = [
  {
    name: 'B 理想操作',
    make: subjectBIdeal,
    wind: WIND_CASES,
    expect: { subject: 'b', rating: 'S' },
  },
  {
    name: 'B 不良①懸停不足',
    make: subjectBHoverTooShort,
    wind: WIND_CASES,
    expect: { subject: 'b', rating: 'U', failKey: 'subjectB.hoverFail' },
  },
  {
    name: 'B 不良②降落超標',
    make: subjectBLandOutsideMarking,
    wind: WIND_CASES,
    expect: { subject: 'b', rating: 'U', failKey: 'subjectB.landingExitMarking' },
  },
  {
    name: 'C 理想操作',
    make: subjectCIdeal,
    wind: WIND_CASES,
    expect: { subject: 'c', rating: 'S' },
  },
  {
    name: 'C 不良①中途停頓',
    make: subjectCPauseMidManeuver,
    wind: WIND_CASES,
    expect: { subject: 'c', rating: 'U', failKey: 'subjectC.pauseFail' },
  },
  {
    name: 'C 不良②軌跡超標',
    make: subjectCOffPath,
    wind: WIND_CASES,
    expect: { subject: 'c', rating: 'U', failKey: 'subjectC.pathFail' },
  },
];

describe('端到端：腳本化操作真的飛完科目 B/C 並由同一套判定評 S/U/N', () => {
  for (const sc of SCENARIOS) {
    for (const wind of sc.wind) {
      it(
        `${sc.name}（${wind.label}）→ ${sc.expect.rating}`,
        () => {
          const o = runScript(sc.make, wind.preset, wind.label, sc.name);
          logOutcome(o);
          expect(o.landed, '應完成降落').toBe(true);
          const result = sc.expect.subject === 'b' ? o.b : o.c;
          expect(result.rating).toBe(sc.expect.rating);
          if (sc.expect.failKey) expect(result.failReasonKeys).toContain(sc.expect.failKey);
          // 理想操作不得觸發任何重大違失。
          if (sc.expect.rating === 'S') expect(o.mf.hasAny).toBe(false);
        },
        60000,
      );
    }
  }
});
