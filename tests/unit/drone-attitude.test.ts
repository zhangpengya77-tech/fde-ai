import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  AIRCRAFT_ATTITUDE_ORDER,
  aircraftAttitudeEuler,
} from '../../src/drone/create-programmatic-f450';
import { SimpleFlightController } from '../../src/flight/adapters/SimpleFlightController';
import type { PilotCommand } from '../../src/flight/types';

/**
 * 機體姿態符號的迴歸釘。
 *
 * 教師回報：「前進時機頭朝上不對」。飛控的位移是對的（沿機頭前進），
 * 但模型的姿態角符號錯了 —— 繞本地 +X 轉正角會把 −Z（機頭）抬向 +Y，
 * 所以「機頭下壓」必須用負角。
 *
 * 這裡不驗「數字有沒有改」，而是把角度真的套到一個 THREE.Object3D 上，
 * 看本地軸在世界座標裡變成什麼方向 —— 也就是教師眼睛看到的東西。
 *
 * 本地座標：機頭 −Z、右側 +X、上方 +Y。
 * 期望：
 *   pitchDeg > 0（cmd.pitch > 0，前進）→ 機頭下壓（nose.y < 0）
 *   rollDeg  > 0（cmd.roll  > 0，右移）→ 右側下沉（right.y < 0）
 *   三個航向（0°/90°/340°）都要成立，因為傾斜是繞本地軸、與航向無關。
 */

interface ModelVectors {
  nose: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

function modelVectors(headingDeg: number, pitchDeg: number, rollDeg: number): ModelVectors {
  const object = new THREE.Object3D();
  const euler = aircraftAttitudeEuler({ headingDeg, pitchDeg, rollDeg });
  object.rotation.set(euler.x, euler.y, euler.z, AIRCRAFT_ATTITUDE_ORDER);
  object.updateMatrixWorld(true);
  const apply = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, y, z).applyMatrix4(object.matrixWorld);
  return {
    nose: apply(0, 0, -1),
    right: apply(1, 0, 0),
    up: apply(0, 1, 0),
  };
}

const HEADINGS = [0, 90, 340];

describe('機體姿態：pitchDeg > 0 必須是機頭下壓', () => {
  it.each(HEADINGS)('heading %i°：pitchDeg = +18 → 機頭下壓（nose.y < 0）', (heading) => {
    const { nose } = modelVectors(heading, 18, 0);
    console.log(`[heading ${heading}°] pitch=+18 → nose=(${nose.x.toFixed(3)}, ${nose.y.toFixed(3)}, ${nose.z.toFixed(3)})`);
    expect(nose.y).toBeLessThan(-0.2);
  });

  it.each(HEADINGS)('heading %i°：pitchDeg = +18 時水平方向仍是機頭方向', (heading) => {
    const { nose } = modelVectors(heading, 18, 0);
    const radians = (heading * Math.PI) / 180;
    // 水平投影方向 = (sin h, −cos h)，與飛控 (sin h, −cos h) 同一套約定。
    const horizontalLength = Math.hypot(nose.x, nose.z);
    expect(nose.x / horizontalLength).toBeCloseTo(Math.sin(radians), 3);
    expect(nose.z / horizontalLength).toBeCloseTo(-Math.cos(radians), 3);
  });

  it.each(HEADINGS)('heading %i°：pitchDeg = −18（後退）→ 機頭抬起', (heading) => {
    const { nose } = modelVectors(heading, -18, 0);
    expect(nose.y).toBeGreaterThan(0.2);
  });

  it.each(HEADINGS)('heading %i°：pitchDeg = 0 → 機頭水平', (heading) => {
    const { nose } = modelVectors(heading, 0, 0);
    expect(nose.y).toBeCloseTo(0, 6);
  });
});

describe('機體姿態：rollDeg > 0 必須是右側下沉', () => {
  it.each(HEADINGS)('heading %i°：rollDeg = +18 → 右側下沉（right.y < 0）', (heading) => {
    const { right, up } = modelVectors(heading, 0, 18);
    console.log(`[heading ${heading}°] roll=+18 → right=(${right.x.toFixed(3)}, ${right.y.toFixed(3)}, ${right.z.toFixed(3)})`);
    expect(right.y).toBeLessThan(-0.2);
    // 右側下沉時，機身上方會往左傾（up.x 在機身座標裡變負）
    expect(up.y).toBeGreaterThan(0);
  });

  it.each(HEADINGS)('heading %i°：rollDeg = +18 時右側的水平方向仍是機身右方', (heading) => {
    const { right } = modelVectors(heading, 0, 18);
    const radians = (heading * Math.PI) / 180;
    const horizontalLength = Math.hypot(right.x, right.z);
    expect(right.x / horizontalLength).toBeCloseTo(Math.cos(radians), 3);
    expect(right.z / horizontalLength).toBeCloseTo(Math.sin(radians), 3);
  });

  it.each(HEADINGS)('heading %i°：rollDeg = −18（左打）→ 右側抬起', (heading) => {
    const { right } = modelVectors(heading, 0, -18);
    expect(right.y).toBeGreaterThan(0.2);
  });
});

describe('機體姿態：前推＋右打的組合', () => {
  it.each(HEADINGS)('heading %i°：pitch +18 / roll +18 → 機頭下壓且右側下沉', (heading) => {
    const { nose, right } = modelVectors(heading, 18, 18);
    expect(nose.y).toBeLessThan(-0.2);
    expect(right.y).toBeLessThan(-0.2);
  });
});

describe('全鏈路：飛控產生的姿態角，套到模型上必須是「前進＝機頭下壓」', () => {
  const LEVEL: PilotCommand = {
    roll: 0, pitch: 0, yaw: 0, throttle: 0.5, arm: false, flightMode: 'manual', gimbalYaw: 0, gimbalPitch: 0,
  };

  function flyForward(headingDeg: number): { pitchDeg: number; rollDeg: number; headingDeg: number } {
    const fc = new SimpleFlightController();
    fc.arm();
    fc.takeoff(5);
    fc.setYaw(headingDeg);
    for (let i = 0; i < 80; i += 1) fc.update(LEVEL, 0.05);
    const forward: PilotCommand = { ...LEVEL, pitch: 1 };
    for (let i = 0; i < 40; i += 1) fc.update(forward, 0.05);
    const snapshot = fc.snapshot();
    return { pitchDeg: snapshot.pitchDeg, rollDeg: snapshot.rollDeg, headingDeg: snapshot.headingDeg };
  }

  function flyRight(headingDeg: number): { pitchDeg: number; rollDeg: number; headingDeg: number } {
    const fc = new SimpleFlightController();
    fc.arm();
    fc.takeoff(5);
    fc.setYaw(headingDeg);
    for (let i = 0; i < 80; i += 1) fc.update(LEVEL, 0.05);
    const right: PilotCommand = { ...LEVEL, roll: 1 };
    for (let i = 0; i < 40; i += 1) fc.update(right, 0.05);
    const snapshot = fc.snapshot();
    return { pitchDeg: snapshot.pitchDeg, rollDeg: snapshot.rollDeg, headingDeg: snapshot.headingDeg };
  }

  it.each(HEADINGS)('heading %i°：pitch 指令 +1 → pitchDeg 為正、模型機頭下壓', (heading) => {
    const attitude = flyForward(heading);
    const { nose } = modelVectors(attitude.headingDeg, attitude.pitchDeg, attitude.rollDeg);
    console.log(`[heading ${heading}°] pitch cmd +1 → pitchDeg=${attitude.pitchDeg.toFixed(1)} nose.y=${nose.y.toFixed(3)}`);
    expect(attitude.pitchDeg).toBeGreaterThan(0);
    expect(nose.y).toBeLessThan(-0.2);
  });

  it.each(HEADINGS)('heading %i°：roll 指令 +1 → rollDeg 為正、模型右側下沉', (heading) => {
    const attitude = flyRight(heading);
    const { right } = modelVectors(attitude.headingDeg, attitude.pitchDeg, attitude.rollDeg);
    console.log(`[heading ${heading}°] roll cmd +1 → rollDeg=${attitude.rollDeg.toFixed(1)} right.y=${right.y.toFixed(3)}`);
    expect(attitude.rollDeg).toBeGreaterThan(0);
    expect(right.y).toBeLessThan(-0.2);
  });
});
