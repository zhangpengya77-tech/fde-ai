// 純計算模組（無 DOM、可用 node 測試）：電池、換相、姿態、教學用足球機運動模型
// 注意：足球機模型是「教學級運動學近似」，不是經驗證的真實飛行物理，畫面上也會標示。

export const CELL = { MIN: 3.0, LOW: 3.2, NOMINAL: 3.7, FULL: 4.2, OVER: 4.25 };

/** 電池組計算：s 串、p 並、單芯電壓 v、單芯容量 mAh */
export function batteryPack({ s = 1, p = 1, cellV = CELL.NOMINAL, cellMah = 1500 } = {}) {
  s = Math.max(1, Math.min(12, Math.round(s)));
  p = Math.max(1, Math.min(6, Math.round(p)));
  const voltage = +(s * cellV).toFixed(2);
  const nominalV = +(s * CELL.NOMINAL).toFixed(2);
  const capacityMah = cellMah * p;
  const energyWh = +(nominalV * capacityMah / 1000).toFixed(1);
  let state = 'ok';
  if (cellV > CELL.FULL + 1e-9) state = 'over';        // 過充：會產氣鼓包，危險
  else if (cellV < CELL.LOW - 1e-9) state = 'under';   // 過放：損傷電芯
  return { s, p, cells: s * p, voltage, nominalV, capacityMah, energyWh, state, label: `${s}S${p}P` };
}

/** 無刷電機六步換相表（A、B、C 三相；+ 為高、- 為低、0 為浮接） */
export const COMMUTATION = [
  { step: 1, name: 'A+ B−', A: '+', B: '-', C: '0' },
  { step: 2, name: 'A+ C−', A: '+', B: '0', C: '-' },
  { step: 3, name: 'B+ C−', A: '0', B: '+', C: '-' },
  { step: 4, name: 'B+ A−', A: '-', B: '+', C: '0' },
  { step: 5, name: 'C+ A−', A: '-', B: '0', C: '+' },
  { step: 6, name: 'C+ B−', A: '0', B: '-', C: '+' }
];

/** 換相步驟對應的定子磁場電角度（度）；每步前進 60° */
export function fieldAngle(stepIndex) {
  return ((stepIndex % 6) + 6) % 6 * 60;
}

/** 電角度換算機械角度：14 極 = 7 對極，機械角 = 電角度 / 極對數 */
export function mechanicalAngle(electricalDeg, poles = 14) {
  return electricalDeg / (poles / 2);
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** 死區：|x| < dz 視為 0，其餘線性重新映射到 0–1 */
export function deadzone(x, dz = 0.08) {
  if (Math.abs(x) < dz) return 0;
  return Math.sign(x) * (Math.abs(x) - dz) / (1 - dz);
}

/**
 * 教學級足球機步進（每幀呼叫）。state: {x,y,z,vx,vy,vz,yaw}，input: {throttle,yaw,pitch,roll} 皆 -1..1
 * 模式：自穩高度保持（油門搖桿＝爬升率），水平速度向搖桿目標速度一階逼近，有空氣阻尼。
 * 座標：x 東、z 南（three.js），y 高度。
 */
export function stepDrone(state, input, dt, opt = {}) {
  const maxH = opt.maxSpeed ?? 4;      // 最大水平速度 m/s
  const maxClimb = opt.maxClimb ?? 2;  // 最大爬升率 m/s
  const yawRate = opt.yawRate ?? 2.2;  // rad/s
  const tau = opt.tau ?? 0.35;         // 速度反應時間常數
  const s = { ...state };
  if (s.armed === false) { s.vx = s.vz = 0; s.vy = s.y > 0 ? -1.5 : 0; }
  else {
    s.yaw += -input.yaw * yawRate * dt;
    // 機體座標的前進（pitch）與右移（roll）轉成世界座標
    const fwd = input.pitch * maxH, right = input.roll * maxH;
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const tvx = -fwd * sin + right * cos;
    const tvz = -fwd * cos - right * sin;
    const k = Math.min(1, dt / tau);
    s.vx += (tvx - s.vx) * k;
    s.vz += (tvz - s.vz) * k;
    s.vy += (input.throttle * maxClimb - s.vy) * k;
  }
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
  // 場地邊界（網籠）：碰牆速度歸零
  const b = opt.bounds ?? { x: 9, z: 5, h: 5 };
  if (Math.abs(s.x) > b.x) { s.x = Math.sign(s.x) * b.x; s.vx = 0; }
  if (Math.abs(s.z) > b.z) { s.z = Math.sign(s.z) * b.z; s.vz = 0; }
  if (s.y < 0) { s.y = 0; s.vy = Math.max(0, s.vy); }
  if (s.y > b.h) { s.y = b.h; s.vy = Math.min(0, s.vy); }
  // 姿態角（顯示用）：與水平加速度成比例
  s.pitchDeg = clamp(input.pitch * 25, -25, 25);
  s.rollDeg = clamp(input.roll * 25, -25, 25);
  return s;
}

/**
 * 穿門判定：上一幀到這一幀的線段是否穿過圓環平面且在半徑內。
 * ring: {x,y,z,r,axis:'x'}，圓環面法線沿 x 軸（球門立在場地兩端）。
 */
export function passedRing(prev, cur, ring) {
  const d0 = prev.x - ring.x, d1 = cur.x - ring.x;
  if (d0 === 0 && d1 === 0) return false;
  if (Math.sign(d0) === Math.sign(d1)) return false;
  const t = d0 / (d0 - d1);
  const y = prev.y + (cur.y - prev.y) * t;
  const z = prev.z + (cur.z - prev.z) * t;
  return Math.hypot(y - ring.y, z - ring.z) <= ring.r;
}

/** 懸停評分：高度誤差與水平漂移（公尺） */
export function hoverOk(s, target = { x: 0, y: 1.5, z: 0 }, tolH = 0.15, tolXY = 0.5) {
  return Math.abs(s.y - target.y) <= tolH && Math.hypot(s.x - target.x, s.z - target.z) <= tolXY;
}

/** 自穩（教學用 PD）：回傳下一幀傾角，用於感測器實驗 */
export function stabilize(angle, rate, dt, on, kp = 6, kd = 2.2) {
  const acc = on ? (-kp * angle - kd * rate) : 0;
  const r = rate + acc * dt;
  return { angle: angle + r * dt, rate: r };
}
