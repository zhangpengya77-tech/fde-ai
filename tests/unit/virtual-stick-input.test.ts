// 虛擬搖桿（原子筆／手機）接入既有輸入管線的測試：數值對應、優先順序、斷訊懸停
import { describe, expect, it } from 'vitest';
import { VirtualStickAdapter, type VirtualSticks } from '../../src/input/adapters/VirtualStickAdapter';
import { PilotInputPipeline } from '../../src/input/PilotInputPipeline';
import type { PilotCommand } from '../../src/flight/types';
import { isStickMessage } from '../../src/input/phone/simlink-client';
import { sticksToCommand, touchToStick } from '../../src/phone/stick-math';

/** 測試用虛擬搖桿：直接餵數值 */
class FakeStick extends VirtualStickAdapter {
  readonly id: string;
  readonly type = 'phone-link' as const;
  readonly label: string;
  constructor(id: string) {
    super();
    this.id = id;
    this.label = id;
  }
  async connect(): Promise<void> {}
  disconnect(): void {
    this.active = false;
  }
  feed(s: Partial<VirtualSticks>, at: number): void {
    this.active = true;
    this.push(s, at);
  }
}

const keyboardCmd: PilotCommand = { roll: 0, pitch: 0, yaw: 0, throttle: 0.5, arm: true, flightMode: 'hover', gimbalYaw: 0, gimbalPitch: 0 };

function pipelineWith(...adapters: FakeStick[]) {
  return new PilotInputPipeline({
    adapters,
    keyboard: () => keyboardCmd,
    profileFor: (id) => adapters.find((a) => a.id === id)?.profile() ?? null,
  });
}

describe('虛擬搖桿 → 飛行指令', () => {
  it('四軸數值原樣變成飛行指令（油門 0..1）', () => {
    const phone = new FakeStick('phone-link');
    phone.feed({ roll: 0.5, pitch: -0.4, yaw: 0.3, throttle: 0.8 }, 1000);
    const { command, source } = pipelineWith(phone).poll(1010);
    expect(source.kind).toBe('adapter');
    expect(command.roll).toBeCloseTo(0.5);
    expect(command.pitch).toBeCloseTo(-0.4);
    expect(command.yaw).toBeCloseTo(0.3);
    expect(command.throttle).toBeCloseTo(0.8);
    expect(command.flightMode).toBe('manual');
  });

  it('還沒啟用（未選色／未配對）時讓鍵盤操作', () => {
    const pen = new FakeStick('camera-pen');
    expect(pipelineWith(pen).poll(1000).source.kind).toBe('keyboard');
  });

  it('超過 0.25 秒沒有新數值（筆離開畫面／手機斷訊）→ 懸停，搖桿歸零但油門保持', () => {
    const pen = new FakeStick('camera-pen');
    pen.feed({ roll: 1, pitch: 1, throttle: 0.7 }, 1000);
    const p = pipelineWith(pen);
    p.poll(1010);
    const { command } = p.poll(1300);
    expect(command.flightMode).toBe('hover');
    expect(command.roll).toBe(0);
    expect(command.pitch).toBe(0);
    expect(command.throttle).toBeCloseTo(0.7);
  });

  it('手機優先於原子筆', () => {
    const phone = new FakeStick('phone-link');
    const pen = new FakeStick('camera-pen');
    phone.feed({ roll: 0.2 }, 1000);
    pen.feed({ roll: -0.9 }, 1000);
    const r = pipelineWith(phone, pen).poll(1005);
    expect(r.source.kind === 'adapter' && r.source.id).toBe('phone-link');
  });

  it('超出範圍的數值會被限制在 ±1 / 0..1', () => {
    const phone = new FakeStick('phone-link');
    phone.feed({ roll: 5, throttle: -3 }, 1000);
    const { command } = pipelineWith(phone).poll(1001);
    expect(command.roll).toBeLessThanOrEqual(1);
    expect(command.throttle).toBeGreaterThanOrEqual(0);
  });
});

describe('手機搖桿數學', () => {
  it('觸控位移換算成搖桿值，往上推為正', () => {
    const s = touchToStick(0, -100, 100);
    expect(s.y).toBeCloseTo(1);
    expect(s.x).toBe(0);
  });

  it('拉出圓框外也不超過 1', () => {
    const s = touchToStick(300, 300, 100);
    expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(1.0001);
  });

  it('放開（回中）＝油門 0.5 保持高度', () => {
    expect(sticksToCommand({ x: 0, y: 0 }, { x: 0, y: 0 }).throttle).toBe(0.5);
    expect(sticksToCommand({ x: 0, y: 1 }, { x: 0, y: 0 }).throttle).toBe(1);
    expect(sticksToCommand({ x: 0, y: -1 }, { x: 0, y: 0 }).throttle).toBe(0);
  });

  it('只接受格式正確的手機訊息', () => {
    expect(isStickMessage({ t: 'sticks', n: 1, roll: 0, pitch: 0, yaw: 0, throttle: 0.5 })).toBe(true);
    expect(isStickMessage({ t: 'sticks', n: 1, roll: 'x', pitch: 0, yaw: 0, throttle: 0.5 })).toBe(false);
    expect(isStickMessage({ t: 'other' })).toBe(false);
    expect(isStickMessage(null)).toBe(false);
  });
});

import { screenTilt, tiltToStick } from '../../src/phone/stick-math';

describe('手機體感操控', () => {
  const flat = { right: 0, toward: 30 };

  it('直向：右側往下傾 → 向右；上緣往前壓 → 前進', () => {
    const t = screenTilt(30, 0, 0);
    expect(t).toEqual({ right: 0, toward: 30 });
    expect(tiltToStick(screenTilt(30, 25, 0), flat).x).toBeCloseTo(1);
    expect(tiltToStick(screenTilt(5, 0, 0), flat).y).toBeCloseTo(1);
  });

  it('橫向 90°：手機本身的 beta 變成畫面左右', () => {
    expect(screenTilt(20, -30, 90)).toEqual({ right: 20, toward: 30 });
    expect(screenTilt(20, -30, -90)).toEqual({ right: -20, toward: -30 });
  });

  it('中立姿勢附近（死區內）不動作', () => {
    expect(tiltToStick({ right: 1, toward: 31 }, flat)).toEqual({ x: 0, y: 0 });
  });

  it('方向反轉開關', () => {
    const s = tiltToStick({ right: 25, toward: 5 }, flat, 25, { roll: true, pitch: true });
    expect(s.x).toBeCloseTo(-1);
    expect(s.y).toBeCloseTo(-1);
  });

  it('傾斜超過範圍也不超過 ±1', () => {
    const s = tiltToStick({ right: 80, toward: -60 }, flat);
    expect(s.x).toBeLessThanOrEqual(1);
    expect(s.y).toBeLessThanOrEqual(1);
  });
});
