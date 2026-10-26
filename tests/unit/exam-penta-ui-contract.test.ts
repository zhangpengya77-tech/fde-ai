import { describe, expect, it } from 'vitest';

/**
 * 科目 E 教學 UI 的 DOM 屬性契約（原始碼文字核對，無需瀏覽器）。
 *
 * 背景（第四輪實測教訓）：按鈕 dataset 曾以 `pentaTraining${action}` 拼接，
 * action 為小寫 'begin' 時產生 data-penta-trainingbegin（缺連字符），
 * 與 tests/browser/exam-penta-training.spec.ts 的 [data-penta-training-begin]
 * 不符，導致整批瀏覽器測試 90s 超時。此測試在單元層封堵該類回歸：
 *  1. 五個動作按鈕屬性名必須是「首字母大寫的可 grep 字面量」；
 *  2. 不得再用字串拼接產生 dataset 鍵；
 *  3. UI 字面量經 kebab 轉換後，必須與瀏覽器測試的選擇器一一對應。
 */

const uiSrc: string = (await import('../../src/exam/penta-training-ui.ts?raw')).default as string;
const specSrc: string = (await import('../browser/exam-penta-training.spec.ts?raw')).default as string;

/** dataset camelCase 鍵 → data-* 屬性名（瀏覽器 DOM 規則）。 */
const toDataAttr = (camel: string): string =>
  `data-${camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;

const BTN_ACTIONS = ['begin', 'pause', 'resume', 'restart', 'abort'] as const;
const CHIP_KEYS = [
  'state',
  'segment',
  'targetAlt',
  'actualAlt',
  'altDev',
  'routeDev',
  'hint',
] as const;

describe('penta-training-ui DOM 屬性契約', () => {
  it('五個動作按鈕皆有首字母大寫的 dataset 屬性字面量', () => {
    for (const action of BTN_ACTIONS) {
      const literal = `pentaTraining${action.charAt(0).toUpperCase()}${action.slice(1)}`;
      expect(uiSrc, `缺少按鈕屬性字面量 '${literal}'`).toContain(`'${literal}'`);
    }
  });

  it('七個 chip 皆有對應的 dataset 屬性字面量', () => {
    for (const key of CHIP_KEYS) {
      const literal = `pentaTraining${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      expect(uiSrc, `缺少 chip 屬性字面量 '${literal}'`).toContain(`'${literal}'`);
    }
  });

  it('不得以字串拼接產生 dataset 鍵（防連字符缺失回歸）', () => {
    expect(uiSrc).not.toMatch(/pentaTraining\$\{/);
  });

  it('每個 UI 屬性字面量都與瀏覽器測試選擇器一一對應', () => {
    const allLiterals = [
      ...BTN_ACTIONS.map((a) => `pentaTraining${a.charAt(0).toUpperCase()}${a.slice(1)}`),
      ...CHIP_KEYS.map((k) => `pentaTraining${k.charAt(0).toUpperCase()}${k.slice(1)}`),
    ];
    for (const literal of allLiterals) {
      const attr = toDataAttr(literal);
      expect(specSrc, `瀏覽器測試缺少選擇器 [${attr}]`).toContain(`[${attr}]`);
    }
  });
});
