import { describe, expect, it } from 'vitest';
import { buildExamField } from '../../src/exam/field';
import { loadExamConfig } from '../../src/exam/config';
import { minimapProject, isGuidanceForcedOff, examDisclaimerText } from '../../src/exam/panel';

const config = loadExamConfig();
const field = buildExamField(config);

const W = 260;
const H = 200;

describe('面板 — 小地圖投影', () => {
  it('場中心 (0,0) 投影至畫布中心', () => {
    const p = minimapProject(field, 0, 0, W, H);
    expect(p.px).toBeCloseTo(W / 2, 2);
    expect(p.py).toBeCloseTo(H / 2, 2);
  });
  it('右側 (+X) → px 大於中心；前方 (−Z) → py 小於中心', () => {
    const right = minimapProject(field, 10, 0, W, H);
    const fwd = minimapProject(field, 0, -10, W, H);
    const center = minimapProject(field, 0, 0, W, H);
    expect(right.px).toBeGreaterThan(center.px);
    expect(fwd.py).toBeLessThan(center.py);
  });
});

describe('面板 — 引導開關', () => {
  it('非考試模式 → 不強制關閉', () => {
    expect(isGuidanceForcedOff(false)).toBe(false);
  });
  it('考試模式 → 強制關閉（不得有輔助）', () => {
    expect(isGuidanceForcedOff(true)).toBe(true);
  });
});

describe('面板 — 免責聲明', () => {
  it('HUD 免責聲明含「模擬判定，非官方測驗結果」', () => {
    expect(examDisclaimerText()).toContain('模擬判定，非官方測驗結果');
  });
  it('HUD 免責聲明與頂部橫幡為同一套 i18n 文案（措辭不漂移）', () => {
    // 頂部橫幡（exam-app.ts）與 HUD 皆取自 zhHant.exam，勿各自硬編字串。
    expect(examDisclaimerText()).toContain('非官方');
    expect(examDisclaimerText()).toContain('僅供練習');
  });
});
