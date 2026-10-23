/**
 * 風場語意單元測試（2026-10-23 教師核准修正）。
 *
 * 修正前語意：瞬時風速 = 平均風 + 陣風振幅（振幅 0..gustMps 振盪）
 *   → 平均 7.5、陣風 10 時瞬時峰值 17.5 m/s，超過定位保持可補償上限（10 m/s），
 *     機體一起飛就被吹走。
 * 修正後語意：`gustMps` 是「瞬時風速的峰值上限（陣峰）」，瞬時風速在
 *   [平均風, 陣峰] 之間波動；平均風＝陣峰時為定風。
 *
 * 逐條改動理由見各 it 的註解（「原斷言 → 新斷言／理由」）。
 */

import { describe, expect, it } from 'vitest';
import { loadExamConfig } from '../../src/exam/config';
import {
  needsSafetyDeclaration,
  readWindPresets,
  SAFETY_DECLARATION,
  WindField,
} from '../../src/exam/wind';

const config = loadExamConfig();

/** 取樣一個完整陣風週期（8s），回傳瞬時風速的最小／最大值。 */
function sampleCycle(w: WindField, seconds = 8, dt = 0.05): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let t = 0; t < seconds; t += dt) {
    w.step(dt);
    const v = w.getInstantSpeedMps();
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { min, max };
}

describe('needsSafetyDeclaration — 純函式門檻（官方 p4，維持不變）', () => {
  it('平均風 7.5 或陣峰 10 即需宣告（含邊界）', () => {
    // 未改動：門檻數值與「或」的語意都是官方值。
    expect(needsSafetyDeclaration(7.5, 0)).toBe(true);
    expect(needsSafetyDeclaration(0, 10)).toBe(true);
    expect(needsSafetyDeclaration(7.5, 10)).toBe(true);
  });
  it('未達門檻不需宣告', () => {
    expect(needsSafetyDeclaration(7.4, 9.9)).toBe(false);
    expect(needsSafetyDeclaration(0, 0)).toBe(false);
    expect(needsSafetyDeclaration(5, 8)).toBe(false);
  });
  it('預設門檻常數為 7.5 / 10 m/s', () => {
    expect(SAFETY_DECLARATION.meanWindMps).toBe(7.5);
    expect(SAFETY_DECLARATION.gustMps).toBe(10);
  });
});

describe('風況選項（config.simAssist.windPresets）', () => {
  it('預設為無風，且四個選項齊備', () => {
    const { presets, defaultPreset } = readWindPresets(config);
    expect(defaultPreset).toBe('calm');
    expect(presets.map((p) => p.key)).toEqual(['calm', 'breeze', 'nearThreshold', 'declaration']);
    const calm = presets.find((p) => p.key === 'calm')!;
    expect(calm.meanMps).toBe(0);
    expect(calm.gustMps).toBe(0);
  });
  it('微風 2/4、接近門檻 7/9、觸發宣告 7.5/10；微風與接近門檻標為非官方', () => {
    const { presets } = readWindPresets(config);
    const byKey = (k: string) => presets.find((p) => p.key === k)!;
    expect([byKey('breeze').meanMps, byKey('breeze').gustMps]).toEqual([2, 4]);
    expect([byKey('nearThreshold').meanMps, byKey('nearThreshold').gustMps]).toEqual([7, 9]);
    expect([byKey('declaration').meanMps, byKey('declaration').gustMps]).toEqual([7.5, 10]);
    expect(byKey('breeze').official).toBe(false);
    expect(byKey('nearThreshold').official).toBe(false);
    expect(byKey('declaration').official).toBe(true);
  });
  it('陣峰不得低於平均風（設定值若顛倒會自動抬升）', () => {
    const { presets } = readWindPresets(config);
    for (const p of presets) expect(p.gustMps).toBeGreaterThanOrEqual(p.meanMps);
  });
});

describe('WindField — 預設風況（原斷言：預設 7.5／需宣告 → 改為無風）', () => {
  it('預設為無風：平均 0、陣峰 0、不需安全宣告', () => {
    // 原斷言：getMeanWindMps()=7.5、needsSafetyDeclaration()=true。
    // 理由：教師指示「預設風改為無風」，風況改由 windPresets 切換。
    const w = new WindField(config);
    expect(w.getPresetKey()).toBe('calm');
    expect(w.getMeanWindMps()).toBe(0);
    expect(w.getGustPeakMps()).toBe(0);
    expect(w.needsSafetyDeclaration()).toBe(false);
    expect(w.getInstantSpeedMps()).toBe(0);
  });
  it('宣告文字仍來自 config.general.wind.declarationText', () => {
    const w = new WindField(config);
    expect(w.getDeclarationText()).toContain('安全宣告');
  });
});

describe('WindField — 陣峰語意（核心修正）', () => {
  it('瞬時風速恆落在 [平均風, 陣峰]，且真的會摸到陣峰', () => {
    // 新斷言（修正前無此概念）：微風 2/4 → 瞬時最小 2、最大 4。
    const w = new WindField(config, { preset: 'breeze' });
    const { min, max } = sampleCycle(w);
    expect(min).toBeCloseTo(2, 3);
    expect(max).toBeCloseTo(4, 3);
    expect(max).toBeLessThanOrEqual(4 + 1e-9);
  });
  it('觸發宣告 7.5／10：瞬時峰值為 10，不是 17.5（舊語意的錯誤）', () => {
    // 原斷言：getGustMagnitudeMps() 在 t=2s 為 12（振幅）；currentVector 峰值 = mean+振幅。
    // 理由：陣風改為「峰值上限」，不得疊加於平均風之上。
    const w = new WindField(config, { preset: 'declaration' });
    const { min, max } = sampleCycle(w);
    expect(min).toBeCloseTo(7.5, 3);
    expect(max).toBeCloseTo(10, 3);
    expect(max).toBeLessThan(10.000001);
  });
  it('平均風＝陣峰時為定風（自訂 mean 5 / gust 0）', () => {
    // 原斷言：mean 5 / gust 0 → 風恆為 5（舊語意下也是 5，這裡明確鎖住相容性）。
    const w = new WindField(config, { meanWindMps: 5, gustMps: 0 });
    expect(w.getGustPeakMps()).toBe(5);
    const { min, max } = sampleCycle(w);
    expect(min).toBeCloseTo(5, 3);
    expect(max).toBeCloseTo(5, 3);
  });
  it('合風向量大小等於瞬時風速（供飛控 applyWind）', () => {
    const w = new WindField(config, { preset: 'breeze' });
    for (let i = 0; i < 40; i += 1) w.step(0.1);
    const v = w.currentVector();
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(w.getInstantSpeedMps(), 6);
  });
});

describe('WindField — 門檻判定改用陣峰（不隨波動閃爍）', () => {
  it('接近門檻 7/9：全程不需宣告', () => {
    // 原斷言：mean 5 / gust 8 永不達門檻 → 改以「接近門檻」風況驗證同一性質。
    const w = new WindField(config, { preset: 'nearThreshold' });
    for (let t = 0; t < 20; t += 0.5) {
      w.step(0.5);
      expect(w.needsSafetyDeclaration()).toBe(false);
    }
  });
  it('平均風 8（無陣風）：恆需宣告', () => {
    const w = new WindField(config, { meanWindMps: 8, gustMps: 0 });
    expect(w.getGustPeakMps()).toBe(8);
    expect(w.needsSafetyDeclaration()).toBe(true);
  });
  it('陣峰 12、平均 0：需宣告，且瞬時仍在 [0,12] 波動', () => {
    // 原斷言：t=2s 時 getGustMagnitudeMps()≈12 且需宣告。
    // 理由：改以「陣峰 12 ≥ 10」直接判定，不需等振幅長到 12。
    const w = new WindField(config, { meanWindMps: 0, gustMps: 12, gustPeriodS: 8 });
    expect(w.needsSafetyDeclaration()).toBe(true);
    const { min, max } = sampleCycle(w);
    expect(min).toBeCloseTo(0, 3);
    expect(max).toBeCloseTo(12, 3);
  });
  it('宣告判定不隨時間閃爍（觸發宣告風況 20s 內恆為 true）', () => {
    const w = new WindField(config, { preset: 'declaration' });
    for (let t = 0; t < 20; t += 0.25) {
      w.step(0.25);
      expect(w.needsSafetyDeclaration()).toBe(true);
    }
  });
});

describe('WindField — 風況切換與狀態輸出', () => {
  it('setPreset 切換風況後，數值與門檻同步更新', () => {
    const w = new WindField(config);
    expect(w.setPreset('breeze')).toBe(true);
    expect(w.getMeanWindMps()).toBe(2);
    expect(w.getGustPeakMps()).toBe(4);
    expect(w.needsSafetyDeclaration()).toBe(false);
    expect(w.setPreset('declaration')).toBe(true);
    expect(w.getMeanWindMps()).toBe(7.5);
    expect(w.getGustPeakMps()).toBe(10);
    expect(w.needsSafetyDeclaration()).toBe(true);
    expect(w.setPreset('no-such-preset')).toBe(false);
    expect(w.getPresetKey()).toBe('declaration');
  });
  it('getState：meanSpeedMps 為平均、gustSpeedMps 為陣峰、instantSpeedMps 為瞬時', () => {
    // 原斷言：s.gustSpeedMps >= 0（舊語意為振幅）。
    // 理由：HUD 要顯示「陣風峰值」，gustSpeedMps 改為峰值。
    const w = new WindField(config, { preset: 'breeze' });
    for (let i = 0; i < 20; i += 1) w.step(0.1);
    const s = w.getState();
    expect(s.meanSpeedMps).toBe(2);
    expect(s.gustSpeedMps).toBe(4);
    expect(s.instantSpeedMps).toBeGreaterThanOrEqual(2);
    expect(s.instantSpeedMps).toBeLessThanOrEqual(4);
    expect(s.speedMps).toBeCloseTo(s.instantSpeedMps, 9);
    // 陣風向量是「瞬時 − 平均」的增量，不是峰值。
    expect(Math.hypot(s.gust.x, s.gust.z)).toBeCloseTo(s.instantSpeedMps - s.meanSpeedMps, 9);
  });
});
