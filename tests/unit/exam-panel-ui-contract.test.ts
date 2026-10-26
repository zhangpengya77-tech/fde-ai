import { describe, expect, it } from 'vitest';

/**
 * 考試 HUD（exam-panel）DOM 屬性契約（原始碼文字核對，無需瀏覽器）。
 *
 * 將第四輪 penta 教學 UI 的「DOM 屬性契約」模式推廣到 exam-panel：
 * 鎖定其根元素 class 與風況行的 data 屬性字面量，並與實際依賴這些選擇器的
 * 瀏覽器測試交叉核對，防止類似「屬性名漂移／連字符缺失」的隱蔽回歸。
 */

const panelSrc = (await import('../../src/exam/panel.ts?raw')).default as string;
const smokeSrc = (await import('../browser/exam-smoke.spec.ts?raw')).default as string;

describe('exam-panel (HUD) DOM 屬性契約', () => {
  it('根元素 class 為 exam-hud，且與 exam-smoke 選擇器 .exam-hud canvas 對應', () => {
    expect(panelSrc).toContain("className = 'exam-hud'");
    expect(smokeSrc).toContain('.exam-hud canvas');
  });

  it('風況行使用字面量 data 屬性 hudWind（非拼接），且本身不含動態 dataset 鍵', () => {
    expect(panelSrc).toContain("dataset.hudWind = 'true'");
    // hudWind 經 kebab 轉換為 data-hud-wind（點號＋字面量，安全）
    // 模塊內不得出現「以模板字符串產生 dataset 鍵」的反模式
    expect(panelSrc).not.toMatch(/dataset\[\s*`/);
  });
});
