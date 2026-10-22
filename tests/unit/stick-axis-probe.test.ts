import { describe, expect, it } from 'vitest';

import type { AxisBinding } from '../../src/input/InputNormalizer';
import {
  buildStickProbeReport,
  detectStickPeak,
  judgeStickProbe,
  NO_GAMEPAD_HINT,
  sameAxisVerdict,
  STICK_PROBE_TESTS,
  trackStickPeak,
  type StickPeak,
} from '../../src/ui/stick-axis-probe';

/**
 * 假搖桿事件：以「靜止陣列 → 推到底陣列」表達一次動作，
 * 不經過瀏覽器，純粹驗證判定文字與建議是否正確。
 *
 * 靜止值取自 2026-10-20 實測（axis0 右左右 +0.015、axis1 右上下 0、
 * axis2 左上下 -1、axis3 左左右 -0.006）。
 */
const REST = [0.015, 0, -1, -0.006];

const PITCH = STICK_PROBE_TESTS.find((test) => test.key === 'pitch')!;
const ROLL = STICK_PROBE_TESTS.find((test) => test.key === 'roll')!;

function bipolar(source: number, reverse = false): AxisBinding {
  return {
    source,
    kind: 'bipolar',
    calibration: { min: -1, center: 0, max: 1, reverse, deadzone: 0, expo: 0 },
  };
}

/** 把某個軸推到指定值（其餘維持靜止），回傳該次取樣。 */
function push(axis: number, value: number): number[] {
  const sample = REST.slice();
  sample[axis] = value;
  return sample;
}

describe('detectStickPeak', () => {
  it('挑出偏離基線最大的軸，並保留原始正負號', () => {
    const peak = detectStickPeak(REST, push(1, -0.98));
    expect(peak).not.toBeNull();
    expect(peak!.axis).toBe(1);
    expect(peak!.delta).toBeCloseTo(-0.98, 5);
    expect(peak!.deviation).toBeCloseTo(0.98, 5);
  });

  it('沒有任何軸超過門檻時回傳 null', () => {
    expect(detectStickPeak(REST, push(1, 0.2))).toBeNull();
    expect(detectStickPeak(REST, REST)).toBeNull();
  });

  it('累積峰值保留推到底的那一筆，不會停在剛過門檻的值', () => {
    let best: StickPeak | null = null;
    for (const value of [-0.35, -0.7, -0.98, -0.6, 0]) {
      best = trackStickPeak(best, REST, push(1, value));
    }
    expect(best!.axis).toBe(1);
    expect(best!.peak).toBeCloseTo(-0.98, 5);
  });
});

describe('judgeStickProbe — 映射正確', () => {
  it('pitch←a1（反），推上為負 → 判 ok，文字含軸號／符號／峰值', () => {
    const peak = detectStickPeak(REST, push(1, -0.98));
    const result = judgeStickProbe(PITCH, peak, bipolar(1, true));

    expect(result.verdict).toBe('ok');
    expect(result.axis).toBe(1);
    expect(result.normalized).toBeCloseTo(1, 1);
    expect(result.suggested).toBeNull();
    expect(result.message).toContain('右桿上下 = axis1');
    expect(result.message).toContain('推上為負');
    expect(result.message).toContain('-0.980');
    expect(result.message).toContain('pitch←a1（反）');
    expect(result.message).toContain('正確');
    expect(result.message).toContain('機頭下壓');
  });

  it('roll←a0（不反向），右打為正 → 判 ok', () => {
    const peak = detectStickPeak(REST, push(0, 0.98));
    const result = judgeStickProbe(ROLL, peak, bipolar(0, false));

    expect(result.verdict).toBe('ok');
    expect(result.message).toContain('右桿左右 = axis0');
    expect(result.message).toContain('右打為正');
    expect(result.message).toContain('roll←a0');
    expect(result.message).not.toContain('（反）');
    expect(result.message).toContain('正確');
  });
});

describe('judgeStickProbe — source 綁錯', () => {
  it('推右桿上下卻動到 axis0 → 建議改 pitch←a0，且不建議翻 reverse', () => {
    // 目前 pitch 綁 axis1，但實測上下動的是 axis0（推上為負）。
    const peak = detectStickPeak(REST, push(0, -0.98));
    const result = judgeStickProbe(PITCH, peak, bipolar(1, true));

    expect(result.verdict).toBe('wrong-source');
    expect(result.axis).toBe(0);
    expect(result.normalized).toBeNull();
    expect(result.suggested).toEqual({ source: 0, reverse: true });
    expect(result.message).toContain('右桿上下 = axis0');
    expect(result.message).toContain('source 綁錯');
    expect(result.message).toContain('建議改 pitch←a0');
    expect(result.message).toContain('reverse=true');
  });

  it('推右桿左右卻動到 axis1 → 建議改 roll←a1（不反向）', () => {
    const peak = detectStickPeak(REST, push(1, 0.98));
    const result = judgeStickProbe(ROLL, peak, bipolar(0, false));

    expect(result.verdict).toBe('wrong-source');
    expect(result.suggested).toEqual({ source: 1, reverse: false });
    expect(result.message).toContain('建議改 roll←a1（reverse=false）');
  });
});

describe('judgeStickProbe — 方向反', () => {
  it('pitch←a1 未反向，推上卻得到負值 → 建議翻 reverse', () => {
    const peak = detectStickPeak(REST, push(1, -0.98));
    const result = judgeStickProbe(PITCH, peak, bipolar(1, false));

    expect(result.verdict).toBe('wrong-direction');
    expect(result.normalized).toBeCloseTo(-1, 1);
    expect(result.suggested).toEqual({ source: 1, reverse: true });
    expect(result.message).toContain('推上為負');
    expect(result.message).toContain('方向反');
    expect(result.message).toContain('pitch←a1');
    expect(result.message).toContain('改為 reverse=true');
  });

  it('roll←a0 已反向，右打卻得到負值 → 建議改回 reverse=false', () => {
    const peak = detectStickPeak(REST, push(0, 0.98));
    const result = judgeStickProbe(ROLL, peak, bipolar(0, true));

    expect(result.verdict).toBe('wrong-direction');
    expect(result.suggested).toEqual({ source: 0, reverse: false });
    expect(result.message).toContain('roll←a0（反）');
    expect(result.message).toContain('改為 reverse=false');
  });
});

describe('judgeStickProbe — 推動幅度不足（峰值 < 0.5）', () => {
  it('峰值 0.4 即使綁錯軸也只判無效，不給 source 綁錯', () => {
    // pitch 綁 axis1，但推到 axis0 只偏離 0.4（< 0.5）：必須是無效，而非錯誤結論。
    const peak = detectStickPeak(REST, push(0, -0.4));
    const result = judgeStickProbe(PITCH, peak, bipolar(1, true));
    expect(result.verdict).toBe('insufficient');
    expect(result.suggested).toBeNull();
    expect(result.message).toContain('峰值僅');
    expect(result.message).toContain('結論無效');
    expect(result.message).not.toContain('source 綁錯');
  });

  it('完全不同於正確軸但峰值很小 → 仍是無效，不給方向反', () => {
    // roll 綁 axis0，但推到 axis1 只偏離 0.4（< 0.5）。
    const peak = detectStickPeak(REST, push(1, 0.4));
    const result = judgeStickProbe(ROLL, peak, bipolar(0, false));
    expect(result.verdict).toBe('insufficient');
    expect(result.message).not.toContain('方向反');
  });
});

describe('sameAxisVerdict', () => {
  it('兩組測試都指向同一軸 → same-axis 無效，提示重測', () => {
    const result = sameAxisVerdict(PITCH, 1, ROLL.label);
    expect(result.verdict).toBe('same-axis');
    expect(result.axis).toBe(1);
    expect(result.suggested).toBeNull();
    expect(result.message).toContain('都指向 axis1');
    expect(result.message).toContain('無效');
    expect(result.message).toContain('重測');
  });
});

describe('judgeStickProbe — 無法判定', () => {
  it('完全沒動 → no-motion，提示推到最上／最右', () => {
    const result = judgeStickProbe(PITCH, null, bipolar(1, true));
    expect(result.verdict).toBe('no-motion');
    expect(result.axis).toBeNull();
    expect(result.message).toContain('沒有偵測到足夠的位移');
  });

  it('軸對但只推了一半（峰值 0.4 < 0.5）→ insufficient，結論無效而非 no-motion', () => {
    const peak = detectStickPeak(REST, push(1, -0.4));
    const result = judgeStickProbe(PITCH, peak, bipolar(1, true));
    expect(result.verdict).toBe('insufficient');
    expect(result.suggested).toBeNull();
    expect(result.message).toContain('結論無效');
    expect(result.message).toContain('推到底');
  });

  it('沒有可比對的綁定時不會給出錯誤結論', () => {
    const peak = detectStickPeak(REST, push(1, -0.98));
    const result = judgeStickProbe(PITCH, peak, null);
    expect(result.verdict).toBe('no-motion');
    expect(result.suggested).toBeNull();
    expect(result.message).toContain('沒有可比較的 pitch 綁定');
  });
});

describe('匯出 JSON', () => {
  it('包含 schema、裝置、生效檔與兩項測試結果', () => {
    const pitch = judgeStickProbe(PITCH, detectStickPeak(REST, push(1, -0.98)), bipolar(1, true));
    const roll = judgeStickProbe(ROLL, detectStickPeak(REST, push(0, 0.98)), bipolar(1, false));
    const report = buildStickProbeReport({
      capturedAt: '2026-10-21T08:00:00.000Z',
      deviceId: 'Radiomaster Pocket Joystick',
      profile: { originKind: 'live', file: 'fde-rc-calibration-x.json', savedAtMs: 1 },
      mapping: 'R←a0 · P←a1（反） · Y←a3 · T←a2',
      results: [pitch, roll],
    });

    expect(report.schema).toBe('fde.stick-axis-probe/1');
    expect(report.deviceId).toBe('Radiomaster Pocket Joystick');
    expect(report.mapping).toBe('R←a0 · P←a1（反） · Y←a3 · T←a2');
    const tests = report.tests as Array<Record<string, unknown>>;
    expect(tests).toHaveLength(2);
    expect(tests[0]).toMatchObject({ test: 'pitch', axis: 1, verdict: 'ok', suggested: null });
    expect(tests[1]).toMatchObject({ test: 'roll', axis: 0, verdict: 'wrong-source', suggested: { source: 0, reverse: false } });
  });

  it('沒有搖桿時的固定文案與需求一致', () => {
    expect(NO_GAMEPAD_HINT).toBe('未偵測到搖桿。USB：請選 USB Joystick (HID)；藍牙：瀏覽器無法讀取');
  });
});
