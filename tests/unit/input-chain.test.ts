import { describe, expect, it } from 'vitest';

import {
  CHAIN_MIN_SIGNAL,
  describeChain,
  noseVector,
  rightVector,
  type ChainSample,
} from '../../src/ui/input-chain';

/**
 * 鏈路診斷面板的判定邏輯：哪一層出錯要說得出來，而且不能誤報。
 *
 * 這裡的每個案例都對應一個真實故障型態：
 *  - normalizer：source 綁錯 / 死區過大 → raw 有值、norm 是 0
 *  - mapper    ：樣本過期被強制懸停 / reverse 寫反 → norm 有值、cmd 沒有或反向
 *  - flight    ：航向旋轉寫錯（症狀 C）→ cmd 正確但機體走反
 */

function sample(overrides: Partial<ChainSample> = {}): ChainSample {
  return {
    rawChannels: [0, 0, -1, 0],
    normalized: { roll: 0, pitch: 0 },
    command: { roll: 0, pitch: 0 },
    velocity: { x: 0, z: 0 },
    headingDeg: 0,
    axes: { roll: { source: 0 }, pitch: { source: 1 } },
    flying: true,
    ...overrides,
  };
}

describe('describeChain — 沒有推動時不下判斷', () => {
  it('四軸靜止 → idle，不會誤報任何一層出錯', () => {
    const report = describeChain(sample());
    expect(report.layer).toBe('idle');
    expect(report.rows.map((row) => row.verdict)).toEqual(['idle', 'idle']);
  });

  it('只有很小的雜訊（< CHAIN_MIN_SIGNAL）→ 仍是 idle', () => {
    const report = describeChain(sample({ normalized: { roll: 0.05, pitch: 0.05 }, command: { roll: 0.05, pitch: 0.05 } }));
    expect(report.layer).toBe('idle');
  });
});

describe('describeChain — 逐層定位', () => {
  it('歸一化層：raw 推到 0.98 但 norm 是 0（source 綁錯）→ layer = normalizer', () => {
    const report = describeChain(
      sample({ rawChannels: [0, 0.98, -1, 0], normalized: { roll: 0, pitch: 0 }, command: { roll: 0, pitch: 0 } }),
    );
    expect(report.layer).toBe('normalizer');
    expect(report.message).toContain('歸一化層');
    expect(report.message).toContain('axis1');
  });

  it('映射層：norm 有值但 cmd 是 0（樣本過期被強制懸停）→ layer = mapper', () => {
    const report = describeChain(
      sample({ normalized: { roll: 0, pitch: 0.98 }, command: { roll: 0, pitch: 0 } }),
    );
    expect(report.layer).toBe('mapper');
    expect(report.message).toContain('映射層');
  });

  it('映射層：norm 與 cmd 反向（reverse 寫反）→ layer = mapper', () => {
    const report = describeChain(
      sample({ normalized: { roll: 0, pitch: 0.98 }, command: { roll: 0, pitch: -0.98 }, velocity: { x: 0, z: 8 } }),
    );
    expect(report.layer).toBe('mapper');
    expect(report.message).toContain('反向');
  });

  it('飛控層：cmd 為正但機體往後飛（症狀 C）→ layer = flight', () => {
    const report = describeChain(
      sample({ normalized: { roll: 0, pitch: 1 }, command: { roll: 0, pitch: 1 }, velocity: { x: 0, z: 6 } }),
    );
    expect(report.layer).toBe('flight');
    expect(report.rows[0].verdict).toBe('reversed');
    expect(report.message).toContain('飛控層');
  });

  it('飛控層：cmd 為正但完全沒位移 → layer = flight（沒動，不是反向）', () => {
    const report = describeChain(
      sample({ normalized: { roll: 0, pitch: 1 }, command: { roll: 0, pitch: 1 }, velocity: { x: 0, z: 0 } }),
    );
    expect(report.layer).toBe('flight');
    expect(report.rows[0].verdict).toBe('no-motion');
  });

  it('鏈路正常：cmd +1 且機體沿機頭前進 → layer = ok', () => {
    const report = describeChain(
      sample({ normalized: { roll: 0, pitch: 1 }, command: { roll: 0, pitch: 1 }, velocity: { x: 0, z: -6 } }),
    );
    expect(report.layer).toBe('ok');
    expect(report.rows[0].verdict).toBe('ok');
    expect(report.message).toContain('鏈路正常');
  });
});

describe('describeChain — 航向不為 0 時用機身座標判讀', () => {
  it('heading 90°：pitch 前推、機體往 +X 走 → ok（不是 reversed）', () => {
    const report = describeChain(
      sample({
        headingDeg: 90,
        normalized: { roll: 0, pitch: 1 },
        command: { roll: 0, pitch: 1 },
        velocity: { x: 6, z: 0 },
      }),
    );
    expect(report.rows[0].forward).toBeCloseTo(6, 6);
    expect(report.rows[0].verdict).toBe('ok');
    expect(report.layer).toBe('ok');
  });

  it('heading 90°：pitch 前推但機體往 −X 走 → flight（這正是修正前的行為）', () => {
    const report = describeChain(
      sample({
        headingDeg: 90,
        normalized: { roll: 0, pitch: 1 },
        command: { roll: 0, pitch: 1 },
        velocity: { x: -6, z: 0 },
      }),
    );
    expect(report.rows[0].forward).toBeCloseTo(-6, 6);
    expect(report.layer).toBe('flight');
  });

  it('heading 45°：roll 右打、機體往機身右側走 → ok', () => {
    const right = rightVector(45);
    const report = describeChain(
      sample({
        headingDeg: 45,
        normalized: { roll: 1, pitch: 0 },
        command: { roll: 1, pitch: 0 },
        velocity: { x: right.x * 6, z: right.z * 6 },
      }),
    );
    expect(report.rows[1].right).toBeCloseTo(6, 6);
    expect(report.rows[1].verdict).toBe('ok');
  });

  it('機頭與右側向量在 8 個航向上都正交', () => {
    for (let heading = 0; heading < 360; heading += 45) {
      const nose = noseVector(heading);
      const right = rightVector(heading);
      expect(Math.hypot(nose.x, nose.z)).toBeCloseTo(1, 6);
      expect(Math.hypot(right.x, right.z)).toBeCloseTo(1, 6);
      expect(nose.x * right.x + nose.z * right.z).toBeCloseTo(0, 6);
    }
  });
});

describe('describeChain — 非飛行狀態', () => {
  it('未起飛時推桿不判成 reversed（機體本來就不會動）', () => {
    const report = describeChain(
      sample({
        flying: false,
        normalized: { roll: 0, pitch: 1 },
        command: { roll: 0, pitch: 1 },
        velocity: { x: 0, z: 0 },
      }),
    );
    expect(report.rows[0].verdict).toBe('idle');
    expect(report.layer).toBe('idle');
  });

  it('CHAIN_MIN_SIGNAL 是公開門檻，面板與測試共用同一個值', () => {
    expect(CHAIN_MIN_SIGNAL).toBeGreaterThan(0);
    expect(CHAIN_MIN_SIGNAL).toBeLessThan(0.5);
  });
});
