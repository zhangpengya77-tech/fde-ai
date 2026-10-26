import { describe, expect, it } from 'vitest';

/**
 * DOM 屬性契約（全倉級守衛）— 第四輪教訓的系統化推廣。
 *
 * 背景：第四輪 penta 教學 UI 曾以 `dataset[`pentaTraining${action}`]` 拼接鍵名，
 * 小寫 action 產生 data-penta-trainingbegin（缺連字符），kebab 轉換後與 E2E 選擇器
 * [data-penta-training-begin] 不符，導致整批瀏覽器測試 90s 超時。修復為類型化字面量映射。
 *
 * 此處把該反模式升級為「全倉守衛」：掃描 src 下所有 .ts，確保任何 UI 模塊都不得
 * 再以模板字符串／字串拼接產生 dataset 鍵或 setAttribute 的 data-* 屬性名。
 * 一旦未來有人在任一模塊重蹈覆轍，此測試即失敗，把缺陷擋在單元層。
 */

const srcFiles = import.meta.glob('../../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('DOM 屬性契約（全倉守衛）', () => {
  it('不得以模板字符串產生 dataset[...] 鍵（防連字符缺失回歸）', () => {
    const offenders: string[] = [];
    const re = /dataset\[\s*`/g; // dataset[ 後緊接反引號 = 模板字面量鍵
    for (const [file, src] of Object.entries(srcFiles)) {
      if (re.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `發現以模板字符串產生 dataset 鍵的模塊：${offenders.join(', ')}`,
    ).toHaveLength(0);
  });

  it('不得以模板字符串／拼接產生 setAttribute 的 data-* 屬性名', () => {
    const offenders: string[] = [];
    // setAttribute( 後第一個參數為反引號模板（含 ${ 插值）
    const tmplRe = /setAttribute\(\s*`[^)]*`\$\{/g;
    // setAttribute('data-' + ...) 形式的字串拼接
    const concatRe = /setAttribute\(\s*'data-[^']*'\s*\+/g;
    for (const [file, src] of Object.entries(srcFiles)) {
      if (tmplRe.test(src) || concatRe.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `發現以動態方式產生 data-* 屬性名的模塊：${offenders.join(', ')}`,
    ).toHaveLength(0);
  });
});
