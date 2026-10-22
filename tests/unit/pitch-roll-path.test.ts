import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { InputNormalizer } from '../../src/input/InputNormalizer';
import { ChannelMapper } from '../../src/input/ChannelMapper';
import { createMode2Profile, type DeviceProfile } from '../../src/input/device-profile';
import { SimpleFlightController } from '../../src/flight/adapters/SimpleFlightController';
import { MissionEngine } from '../../src/mission/MissionEngine';
import type { PilotCommand } from '../../src/flight/types';
import { forwardSpeed, rightSpeed } from '../../src/ui/direction-acceptance';
import { noseVector, rightVector } from '../../src/ui/input-chain';

/**
 * 症狀 C 的迴歸釘：raw 通道 → InputNormalizer → ChannelMapper →
 * SimpleFlightController → position.x / position.z 這條完整路徑。
 *
 * 教師真機回報「前推時機體橫向移動，右打時機體前後移動」，輸入層 source 已由
 * 真機數據確認為 roll←axis0 / pitch←axis1（沒有互換）。所以問題只能在「映射
 * 之後」的那一層 —— 也就是飛控把指令旋轉到世界座標時用的航向矩陣。
 *
 * 這裡刻意不用假的 command，而是從「原始搖桿值」開始跑完整條鏈路：這樣任何
 * 一層（校正、歸一化、映射、旋轉）改壞都會讓這些測試變紅。
 *
 * 方向約定（全專案唯一一套）：
 *   機頭 = (sin h, 0, −cos h)   heading 0 → −Z，heading 90 → +X
 *   右側 = (cos h, 0,  sin h)   heading 0 → +X，heading 90 → +Z
 */

const PAD_ID = 'Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)';
/**
 * 中性樣本。刻意把右桿／偏航的靜止偏移歸零：`createMode2Profile` 的預設草稿
 * deadzone = 0（真機標定檔才是 0.05），留著真機的 +0.015 / −0.006 殘留會讓
 * 每一條通道都帶一點雜訊，干擾「垂直/水平是否互不串擾」這件事的判讀。
 * 真機殘留造成的漂移另有測試（simple-flight-controller 的無輸入衰減）。
 */
const REST = [0, 0, -1, 0, 0, 0, 0, 0];
const THROTTLE_LEVEL = 0; // axis2 推中間 → 歸一化 0.5 → 定高

function profile(): DeviceProfile {
  return createMode2Profile(PAD_ID);
}

/** 用「原始通道陣列」跑完整條鏈路，回傳最終指令（不含飛控）。 */
function mapRaw(raw: number[], nowMs = 1000): PilotCommand {
  const p = profile();
  const mapper = new ChannelMapper(p);
  return mapper.mapRaw({
    raw: { timestampMs: nowMs, channels: raw, buttons: [], connected: true },
    profile: p,
    nowMs,
  });
}

interface FlightResult {
  position: { x: number; y: number; z: number };
  command: PilotCommand;
  normalized: { roll: number; pitch: number; yaw: number; throttle: number };
}

/**
 * 從「原始搖桿值」一路飛到位置：校正 → 歸一化 → 映射 → 飛控積分。
 *
 * `headingDeg` 直接設定飛控航向（等同教師先打偏航到那個角度），
 * `frames` 預設 40 帧 × 0.05 s = 2 秒。
 */
function flyFromRaw(raw: number[], options: { headingDeg?: number; frames?: number } = {}): FlightResult {
  const frames = options.frames ?? 40;
  const delta = 0.05;
  const fc = new SimpleFlightController();
  fc.arm();
  fc.takeoff(5);
  fc.setYaw(options.headingDeg ?? 0);

  // 先飛到定高、脫離 taking-off（用中立樣本，不帶任何水平指令）。
  const level: PilotCommand = {
    roll: 0, pitch: 0, yaw: 0, throttle: 0.5, arm: false, flightMode: 'manual', gimbalYaw: 0, gimbalPitch: 0,
  };
  for (let i = 0; i < 80; i += 1) fc.update(level, delta);

  const command = mapRaw(raw);
  for (let i = 0; i < frames; i += 1) fc.update(command, delta);

  const normalized = new InputNormalizer().normalizeChannels(
    { timestampMs: 1000, channels: raw, buttons: [], connected: true },
    profile().axes,
  );
  return { position: { ...fc.snapshot().position }, command, normalized };
}

/** 只看水平位移，忽略定高過程的殘留。 */
function horizontalDelta(from: { x: number; z: number }, to: { x: number; z: number }) {
  return { dx: to.x - from.x, dz: to.z - from.z };
}

describe('症狀 C 迴歸：raw → normalizer → mapper → flight → 位移', () => {
  it('原始通道 → 指令：右桿上推（axis1 = +0.98）得到 pitch = +1，右打（axis0 = +0.98）得到 roll = +1', () => {
    const up = [...REST];
    up[1] = 0.98;
    up[2] = THROTTLE_LEVEL;
    const pitchCommand = mapRaw(up);
    // 預設草稿 deadzone = 0，所以 0.98 原樣穿過（1:1）。
    expect(pitchCommand.pitch).toBeCloseTo(0.98, 2);
    expect(pitchCommand.roll).toBeCloseTo(0, 2);

    const right = [...REST];
    right[0] = 0.98;
    right[2] = THROTTLE_LEVEL;
    const rollCommand = mapRaw(right);
    expect(rollCommand.roll).toBeCloseTo(0.98, 2);
    expect(rollCommand.pitch).toBeCloseTo(0, 2);
  });

  it('航向 0°：只給 pitch → Δz 為負（前進）、Δx ≈ 0', () => {
    const raw = [...REST];
    raw[1] = 0.98;
    raw[2] = THROTTLE_LEVEL;
    const result = flyFromRaw(raw, { headingDeg: 0 });
    const start = { x: 0, z: 0 };
    const { dx, dz } = horizontalDelta(start, result.position);
    console.log(`[heading 0] pitch=+1 → Δx=${dx.toFixed(3)} Δz=${dz.toFixed(3)}`);
    expect(result.command.pitch).toBeGreaterThan(0.9);
    expect(dz).toBeLessThan(-1);
    expect(Math.abs(dx)).toBeLessThan(0.05);
  });

  it('航向 0°：只給 roll → Δx 為正（右移）、Δz ≈ 0', () => {
    const raw = [...REST];
    raw[0] = 0.98;
    raw[2] = THROTTLE_LEVEL;
    const result = flyFromRaw(raw, { headingDeg: 0 });
    const { dx, dz } = horizontalDelta({ x: 0, z: 0 }, result.position);
    console.log(`[heading 0] roll=+1 → Δx=${dx.toFixed(3)} Δz=${dz.toFixed(3)}`);
    expect(result.command.roll).toBeGreaterThan(0.9);
    expect(dx).toBeGreaterThan(1);
    expect(Math.abs(dz)).toBeLessThan(0.05);
  });

  it('航向 90°：只給 pitch → Δx 為正（機頭朝 +X）、Δz ≈ 0', () => {
    const raw = [...REST];
    raw[1] = 0.98;
    raw[2] = THROTTLE_LEVEL;
    const result = flyFromRaw(raw, { headingDeg: 90 });
    const { dx, dz } = horizontalDelta({ x: 0, z: 0 }, result.position);
    console.log(`[heading 90] pitch=+1 → Δx=${dx.toFixed(3)} Δz=${dz.toFixed(3)}`);
    expect(dx).toBeGreaterThan(1);
    expect(Math.abs(dz)).toBeLessThan(0.05);
  });

  it('航向 90°：只給 roll → Δz 為正（右側朝 +Z）、Δx ≈ 0', () => {
    const raw = [...REST];
    raw[0] = 0.98;
    raw[2] = THROTTLE_LEVEL;
    const result = flyFromRaw(raw, { headingDeg: 90 });
    const { dx, dz } = horizontalDelta({ x: 0, z: 0 }, result.position);
    console.log(`[heading 90] roll=+1 → Δx=${dx.toFixed(3)} Δz=${dz.toFixed(3)}`);
    expect(dz).toBeGreaterThan(1);
    expect(Math.abs(dx)).toBeLessThan(0.05);
  });

  it('航向 45°：前推仍然「沿機頭」前進（不再偏 90°）', () => {
    const raw = [...REST];
    raw[1] = 0.98;
    raw[2] = THROTTLE_LEVEL;
    const result = flyFromRaw(raw, { headingDeg: 45 });
    const { dx, dz } = horizontalDelta({ x: 0, z: 0 }, result.position);
    const nose = noseVector(45);
    const alongNose = dx * nose.x + dz * nose.z;
    const acrossNose = Math.abs(dx * -nose.z + dz * nose.x);
    console.log(`[heading 45] pitch=+1 → Δx=${dx.toFixed(3)} Δz=${dz.toFixed(3)} 沿機頭=${alongNose.toFixed(3)} 橫向=${acrossNose.toFixed(3)}`);
    expect(alongNose).toBeGreaterThan(1);
    expect(acrossNose).toBeLessThan(0.05);
  });
});

describe('航向旋轉矩陣與機體模型／雲台相機一致', () => {
  /** 機體模型用的旋轉：group.rotation.y = −heading（create-programmatic-f450.ts）。 */
  function modelNose(headingDeg: number): { x: number; z: number } {
    const euler = new THREE.Euler(0, THREE.MathUtils.degToRad(-headingDeg), 0, 'YXZ');
    const v = new THREE.Vector3(0, 0, -1).applyEuler(euler);
    return { x: v.x, z: v.z };
  }

  /** 雲台相機用的 forward（create-app.ts computeCameraPose，pitch = 0）。 */
  function gimbalNose(headingDeg: number): { x: number; z: number } {
    const h = (headingDeg * Math.PI) / 180;
    return { x: Math.cos(0) * Math.sin(h), z: -Math.cos(0) * Math.cos(h) };
  }

  it.each([0, 30, 45, 90, 135, 180, 270])(
    'heading %i°：飛控用的機頭向量 = 模型旋轉 = 雲台相機 forward',
    (heading) => {
      const flight = noseVector(heading);
      const model = modelNose(heading);
      const gimbal = gimbalNose(heading);
      expect(flight.x).toBeCloseTo(model.x, 6);
      expect(flight.z).toBeCloseTo(model.z, 6);
      expect(flight.x).toBeCloseTo(gimbal.x, 6);
      expect(flight.z).toBeCloseTo(gimbal.z, 6);
    },
  );

  it.each([0, 45, 90, 180])('heading %i°：右側向量與機頭向量正交且指向右手邊', (heading) => {
    const nose = noseVector(heading);
    const right = rightVector(heading);
    expect(nose.x * right.x + nose.z * right.z).toBeCloseTo(0, 6);
    // 右手邊 = 機頭繞 +Y 轉 −90°：(x, z) → (−z, x)
    expect(right.x).toBeCloseTo(-nose.z, 6);
    expect(right.z).toBeCloseTo(nose.x, 6);
  });

  it('方向驗收用的分量與飛控一致（heading 90°：前進 = +X、右移 = +Z）', () => {
    const sample = {
      state: 'flying',
      command: { roll: 0, pitch: 1, yaw: 0, throttle: 0.5 },
      velocity: { x: 6, y: 0, z: 0 },
      headingDeg: 90,
    };
    expect(forwardSpeed(sample)).toBeCloseTo(6, 6);
    expect(rightSpeed(sample)).toBeCloseTo(0, 6);

    const rightSample = { ...sample, velocity: { x: 0, y: 0, z: 6 } };
    expect(forwardSpeed(rightSample)).toBeCloseTo(0, 6);
    expect(rightSpeed(rightSample)).toBeCloseTo(6, 6);
  });
});

describe('任務失敗狀態下，手動輸入仍然有效', () => {
  it('MissionEngine 進入 FAILED 後，飛控照樣吃手動指令並位移', () => {
    const mission = new MissionEngine();
    mission.fail('模擬：碰撞導致任務失敗');
    expect(mission.currentState).toBe('FAILED');

    const raw = [...REST];
    raw[1] = 0.98;
    raw[2] = THROTTLE_LEVEL;
    const result = flyFromRaw(raw, { headingDeg: 0 });
    const { dx, dz } = horizontalDelta({ x: 0, z: 0 }, result.position);
    console.log(`[mission FAILED] pitch=+1 → Δx=${dx.toFixed(3)} Δz=${dz.toFixed(3)}`);
    expect(result.command.flightMode).toBe('manual');
    expect(dz).toBeLessThan(-1);
    expect(Math.abs(dx)).toBeLessThan(0.05);
  });

  it('MissionEngine 進入 FAILED 後，右打仍然右移（不是被鎖死或反向）', () => {
    const mission = new MissionEngine();
    mission.fail('模擬：任務失敗');
    const raw = [...REST];
    raw[0] = 0.98;
    raw[2] = THROTTLE_LEVEL;
    const result = flyFromRaw(raw, { headingDeg: 0 });
    const { dx, dz } = horizontalDelta({ x: 0, z: 0 }, result.position);
    expect(dx).toBeGreaterThan(1);
    expect(Math.abs(dz)).toBeLessThan(0.05);
    expect(mission.currentState).toBe('FAILED');
  });

  it('緊急停止（飛控 emergency）才是真的鎖住輸入 —— 與任務失敗區分開', () => {
    const fc = new SimpleFlightController();
    fc.arm();
    fc.takeoff(5);
    const level: PilotCommand = {
      roll: 0, pitch: 0, yaw: 0, throttle: 0.5, arm: false, flightMode: 'manual', gimbalYaw: 0, gimbalPitch: 0,
    };
    for (let i = 0; i < 80; i += 1) fc.update(level, 0.05);
    const before = { ...fc.snapshot().position };
    fc.emergencyStop();
    const push: PilotCommand = { ...level, pitch: 1 };
    for (let i = 0; i < 40; i += 1) fc.update(push, 0.05);
    const after = fc.snapshot().position;
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
  });
});
