import { describe, expect, it } from 'vitest';
import { loadExamConfig } from '../../src/exam/config';
import { needsSafetyDeclaration, SAFETY_DECLARATION, WindField } from '../../src/exam/wind';

const config = loadExamConfig();

describe('needsSafetyDeclaration — 純函式門檻（p4）', () => {
  it('平均風 7.5 或陣風 10 即需宣告（含邊界）', () => {
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

describe('WindField — 預設取自 config（mean 7.5 / gust 10）', () => {
  it('預設即達門檻，需安全宣告', () => {
    const w = new WindField(config);
    expect(w.getMeanWindMps()).toBeCloseTo(7.5, 5);
    expect(w.needsSafetyDeclaration()).toBe(true);
  });
  it('宣告文字來自 config.general.wind.declarationText', () => {
    const w = new WindField(config);
    expect(w.getDeclarationText()).toContain('安全宣告');
  });
});

describe('WindField — 時間演化與門檻', () => {
  it('平均風 5、陣風 8：永不達門檻', () => {
    const w = new WindField(config, { meanWindMps: 5, gustMps: 8 });
    for (let t = 0; t < 20; t += 0.5) w.step(0.5);
    expect(w.needsSafetyDeclaration()).toBe(false);
  });
  it('平均風 8（無陣風）：恆需宣告', () => {
    const w = new WindField(config, { meanWindMps: 8, gustMps: 0 });
    expect(w.needsSafetyDeclaration()).toBe(true);
  });
  it('平均 0、陣風 12：陣風峰值達 10 時觸發宣告', () => {
    const w = new WindField(config, { meanWindMps: 0, gustMps: 12, gustPeriodS: 8 });
    // 週期 8s，|sin| 在 t=2s 達 1 → 陣風振幅 12 ≥ 10（step 每幀 ≤0.1s，故分多次推進）。
    expect(w.needsSafetyDeclaration()).toBe(false); // t=0 振幅 0
    for (let i = 0; i < 20; i += 1) w.step(0.1); // 推進到 t=2s
    expect(w.getGustMagnitudeMps()).toBeCloseTo(12, 4);
    expect(w.needsSafetyDeclaration()).toBe(true);
  });
  it('step 後合風向量隨時間變化（陣風分量改變）', () => {
    const w = new WindField(config, { meanWindMps: 5, gustMps: 8 });
    const v0 = w.currentVector();
    w.step(1);
    const v1 = w.currentVector();
    // 平均 5 + 陣風(t=1, period8) ≈ 5 + 8*sin(π/4)=5+5.66=10.66
    expect(Math.hypot(v1.x, v1.z)).toBeGreaterThan(Math.hypot(v0.x, v0.z));
  });
  it('getState 回傳 WindState 且 meanSpeedMps 為設定值', () => {
    const w = new WindField(config, { meanWindMps: 6, gustMps: 9 });
    const s = w.getState();
    expect(s.meanSpeedMps).toBeCloseTo(6, 5);
    expect(s.gustSpeedMps).toBeGreaterThanOrEqual(0);
    expect(s.speedMps).toBeGreaterThanOrEqual(s.meanSpeedMps - 0.001);
  });
});
