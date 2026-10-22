import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_MIN_COMMAND,
  ACCEPTANCE_MIN_SPEED,
  buildAcceptanceReport,
  forwardSpeed,
  horizontalSpeed,
  isReleased,
  judgeAcceptance,
  rightSpeed,
  type AcceptanceSample,
} from '../../src/ui/direction-acceptance';

function sample(overrides: Partial<AcceptanceSample> = {}): AcceptanceSample {
  return {
    state: 'flying',
    command: { roll: 0, pitch: 0, yaw: 0, throttle: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    headingDeg: 0,
    ...overrides,
  };
}

describe('forwardSpeed / rightSpeed（航向無關）', () => {
  it('heading=0：前進 = −Z，右移 = +X', () => {
    const forward = sample({ velocity: { x: 0, y: 0, z: -3 } });
    const right = sample({ velocity: { x: 2, y: 0, z: 0 } });
    expect(forwardSpeed(forward)).toBeCloseTo(3, 6);
    expect(rightSpeed(right)).toBeCloseTo(2, 6);
    expect(horizontalSpeed(sample({ velocity: { x: 3, y: 0, z: 4 } }))).toBeCloseTo(5, 6);
  });

  it('heading=90°：前進分量跟著航向轉（機頭朝 +X，與機體模型 rotation.y=−heading 一致）', () => {
    // h=90° 時機頭朝 +X：往前飛會得到 vx = +3。
    // 2026-10-22 修正：這裡原本寫「機頭朝 −X」，與模型旋轉和雲台相機相反，
    // 正是「症狀 C」的來源（前推變橫移、右打變前後移動）。
    const s = sample({ headingDeg: 90, velocity: { x: 3, y: 0, z: 0 } });
    expect(forwardSpeed(s)).toBeCloseTo(3, 6);
    expect(rightSpeed(s)).toBeCloseTo(0, 6);
  });

  it('heading=90°：右側朝 +Z（機頭 +X 的右手邊）', () => {
    const s = sample({ headingDeg: 90, velocity: { x: 0, y: 0, z: 3 } });
    expect(rightSpeed(s)).toBeCloseTo(3, 6);
    expect(forwardSpeed(s)).toBeCloseTo(0, 6);
  });
});

describe('judgeAcceptance — 右桿前推（pitch）', () => {
  it('Pitch 為正且機體前進 → 通過', () => {
    const judgement = judgeAcceptance('pitch', sample({ command: { roll: 0, pitch: 1, yaw: 0, throttle: 0.5 }, velocity: { x: 0, y: 0, z: -4 } }));
    expect(judgement.verdict).toBe('pass');
    expect(judgement.numbers.pitch).toBe(1);
    expect(judgement.numbers.forward).toBeGreaterThan(ACCEPTANCE_MIN_SPEED);
  });

  it('Pitch 為負（推反了）→ 失敗並提示翻 reverse', () => {
    const judgement = judgeAcceptance('pitch', sample({ command: { roll: 0, pitch: -1, yaw: 0, throttle: 0.5 } }));
    expect(judgement.verdict).toBe('fail');
    expect(judgement.detail).toContain('reverse');
  });

  it('Pitch 為正但機體沒動 → 失敗', () => {
    const judgement = judgeAcceptance('pitch', sample({ command: { roll: 0, pitch: 1, yaw: 0, throttle: 0.5 } }));
    expect(judgement.verdict).toBe('fail');
    expect(judgement.detail).toContain('未前進');
  });

  it('尚未推動 → 等待', () => {
    const judgement = judgeAcceptance('pitch', sample({ command: { roll: 0, pitch: 0.2, yaw: 0, throttle: 0.5 } }));
    expect(judgement.verdict).toBe('pending');
    expect(Math.abs(0.2)).toBeLessThan(ACCEPTANCE_MIN_COMMAND);
  });

  it('不在飛行狀態 → 等待並提示先起飛', () => {
    const judgement = judgeAcceptance('pitch', sample({ state: 'disarmed', command: { roll: 0, pitch: 1, yaw: 0, throttle: 0 } }));
    expect(judgement.verdict).toBe('pending');
    expect(judgement.detail).toContain('解鎖並起飛');
  });
});

describe('judgeAcceptance — 右桿右打（roll）', () => {
  it('Roll 為正且機體右移 → 通過', () => {
    const judgement = judgeAcceptance('roll', sample({ command: { roll: 1, pitch: 0, yaw: 0, throttle: 0.5 }, velocity: { x: 4, y: 0, z: 0 } }));
    expect(judgement.verdict).toBe('pass');
    expect(judgement.numbers.right).toBeGreaterThan(ACCEPTANCE_MIN_SPEED);
  });

  it('Roll 為負（打反了）→ 失敗', () => {
    const judgement = judgeAcceptance('roll', sample({ command: { roll: -1, pitch: 0, yaw: 0, throttle: 0.5 } }));
    expect(judgement.verdict).toBe('fail');
    expect(judgement.detail).toContain('reverse');
  });
});

describe('judgeAcceptance — 放開（停止）', () => {
  it('未放開 → 等待', () => {
    const judgement = judgeAcceptance('release', sample({ command: { roll: 0, pitch: 1, yaw: 0, throttle: 0.5 } }));
    expect(judgement.verdict).toBe('pending');
    expect(isReleased(sample({ command: { roll: 0, pitch: 1, yaw: 0, throttle: 0.5 } }))).toBe(false);
  });

  it('已放開但還沒等滿穩定時間 → 等待', () => {
    const judgement = judgeAcceptance('release', sample({ velocity: { x: 1, y: 0, z: 0 } }), false);
    expect(judgement.verdict).toBe('pending');
  });

  it('放開並等滿 1.2 秒後殘速趨近 0 → 通過', () => {
    const judgement = judgeAcceptance('release', sample({ velocity: { x: 0.01, y: 0, z: 0 } }), true);
    expect(judgement.verdict).toBe('pass');
  });

  it('放開後仍在快速移動 → 失敗', () => {
    const judgement = judgeAcceptance('release', sample({ velocity: { x: 2, y: 0, z: 0 } }), true);
    expect(judgement.verdict).toBe('fail');
    expect(judgement.detail).toContain('殘速');
  });
});

describe('buildAcceptanceReport', () => {
  it('匯出內容含三項結果與映射', () => {
    const report = buildAcceptanceReport({
      capturedAt: '2026-10-22T00:00:00.000Z',
      deviceId: 'pad-1',
      mapping: 'R←a0 · P←a1（反） · Y←a3 · T←a2',
      records: [
        { key: 'pitch', verdict: 'pass', detail: 'ok', numbers: { pitch: 1, forward: 4 }, at: '2026-10-22T00:00:00.000Z' },
        { key: 'roll', verdict: 'fail', detail: 'ng', numbers: { roll: -1, right: 0 }, at: '2026-10-22T00:00:00.000Z' },
        { key: 'release', verdict: 'idle', detail: '—', numbers: {}, at: '2026-10-22T00:00:00.000Z' },
      ],
    });
    expect(report.schema).toBe('fde.direction-acceptance/1');
    expect((report.results as unknown[]).length).toBe(3);
    expect(report.mapping).toContain('P←a1');
  });
});
