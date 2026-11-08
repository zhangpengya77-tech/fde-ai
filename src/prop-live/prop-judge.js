/**
 * F450 螺旋槳安裝檢查：共用判定模組（圖片上傳、即時鏡頭都走這裡，結果必須一致）。
 *
 * judgePropellers(detections, rules, context?) → 判定結果（純函式，不碰 DOM、不連網）
 *   detections：[{ class: 'CW'|'CCW', confidence: 0~1, bbox: [x1, y1, x2, y2] }]（像素或正規化座標皆可）
 *   rules     ：prop-judge-rules.json 的內容（版面、期望類別、門檻全部由設定檔決定）
 *   context   ：{ unstable?: boolean }（即時模式由穩定化模組判斷畫面是否晃動）
 *
 * 三種狀態（寧可無法判斷，也不亂判斷）：
 *   CORRECT   ：四個象限都偵測到且全部正確 → 全綠
 *   WRONG     ：偵測清楚，但有象限旋向相反 → 錯者紅、對者綠，逐位置列出
 *   UNCERTAIN ：數量不是 4、信心不足、同象限衝突、框過度重疊、未知類別、畫面晃動 → 全灰，絕不出現綠色
 *
 * 象限以「四個偵測框中心點的重心」劃分，不使用固定畫面座標，所以機身不必在畫面正中央。
 * formatJudgement(result, messages, options?) 把判定結果轉成 i18n 文字（文字放在 prop-live.zh-TW.json）。
 */
(function attachPropJudge(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.FdePropJudge = api;
  }
})(globalThis, function createPropJudge() {
  const QUADRANTS = ['TL', 'TR', 'BL', 'BR'];

  /** 取出框座標；格式不對時回傳 null（該框視為無效，整體判為無法判斷）。 */
  function boxOf(detection) {
    const box = detection && (detection.bbox || detection.box);
    if (!Array.isArray(box) || box.length !== 4 || box.some((v) => !Number.isFinite(Number(v)))) return null;
    const [x1, y1, x2, y2] = box.map(Number);
    if (x2 <= x1 || y2 <= y1) return null;
    return [x1, y1, x2, y2];
  }

  function centerOf(box) {
    return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  }

  /** 兩框的 IoU（交集 / 聯集）。 */
  function iou(a, b) {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inter = ix * iy;
    const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    return union > 0 ? inter / union : 0;
  }

  /** 檢查設定檔必要欄位，缺漏直接丟錯（不使用程式內建預設值，避免規則被悄悄改掉）。 */
  function assertRules(rules) {
    const need = ['classes', 'layout', 'expectedCount', 'minConfidence', 'candidateConfidence', 'maxOverlapIoU', 'minQuadrantMargin'];
    for (const key of need) {
      if (!rules || rules[key] === undefined) throw new Error(`prop_rules_missing_${key}`);
    }
    for (const q of QUADRANTS) {
      if (!rules.classes.includes(rules.layout[q])) throw new Error(`prop_rules_layout_invalid_${q}`);
    }
  }

  function judgePropellers(detections, rules, context) {
    assertRules(rules);
    const ctx = context || {};
    const result = {
      ruleVersion: rules.version || '',
      state: 'UNCERTAIN',
      reasonCode: '',
      positions: {},
      wrong: [],
      allReversed: false,
      boxes: []
    };
    // 先把所有候選框整理好，UNCERTAIN 時一律以灰色顯示
    const candidates = [];
    for (const item of Array.isArray(detections) ? detections : []) {
      const confidence = Number(item && item.confidence);
      if (!(confidence >= rules.candidateConfidence)) continue;
      const box = boxOf(item);
      candidates.push({ cls: String((item && (item.class || item.className)) || ''), confidence, box });
    }
    const uncertain = (code) => {
      result.state = 'UNCERTAIN';
      result.reasonCode = code;
      result.positions = {};
      result.wrong = [];
      result.allReversed = false;
      result.boxes = candidates.filter((c) => c.box).map((c) => ({ bbox: c.box, class: c.cls, confidence: c.confidence, color: 'gray', position: null }));
      return result;
    };

    if (ctx.unstable) return uncertain('UNSTABLE');
    if (!candidates.length) return uncertain('NO_DETECTION');
    if (candidates.some((c) => !c.box)) return uncertain('COUNT_MISMATCH');
    if (candidates.some((c) => !rules.classes.includes(c.cls))) return uncertain('UNKNOWN_CLASS');

    const strong = candidates.filter((c) => c.confidence >= rules.minConfidence);
    const weak = candidates.filter((c) => c.confidence < rules.minConfidence);

    // 達門檻的框彼此過度重疊 → 可能重複框，無法判斷
    for (let i = 0; i < strong.length; i++) {
      for (let j = i + 1; j < strong.length; j++) {
        if (iou(strong[i].box, strong[j].box) > rules.maxOverlapIoU) return uncertain('OVERLAP');
      }
    }
    // 低信心框：與某個達門檻框重疊者視為同一支槳的重複候選；獨立存在者代表「可能還有一支槳看不清」
    const looseWeak = weak.filter((w) => strong.every((s) => iou(w.box, s.box) <= rules.maxOverlapIoU));
    if (looseWeak.length) return uncertain('LOW_CONFIDENCE');
    if (strong.length !== rules.expectedCount) return uncertain('COUNT_MISMATCH');

    // 以四個中心點的重心劃分象限（畫面 y 軸向下：y 小者在上）
    const centers = strong.map((s) => centerOf(s.box));
    const cx = centers.reduce((sum, c) => sum + c[0], 0) / centers.length;
    const cy = centers.reduce((sum, c) => sum + c[1], 0) / centers.length;
    const spanX = Math.max(...centers.map((c) => c[0])) - Math.min(...centers.map((c) => c[0]));
    const spanY = Math.max(...centers.map((c) => c[1])) - Math.min(...centers.map((c) => c[1]));
    const marginX = spanX * rules.minQuadrantMargin;
    const marginY = spanY * rules.minQuadrantMargin;
    const assigned = {};
    for (let i = 0; i < strong.length; i++) {
      const [x, y] = centers[i];
      // 太靠近重心分界線 → 左右或上下無法確定
      if (spanX <= 0 || spanY <= 0 || Math.abs(x - cx) <= marginX || Math.abs(y - cy) <= marginY) return uncertain('QUADRANT_CONFLICT');
      const q = (y < cy ? 'T' : 'B') + (x < cx ? 'L' : 'R');
      if (assigned[q]) return uncertain('QUADRANT_CONFLICT');
      assigned[q] = strong[i];
    }

    for (const q of QUADRANTS) {
      const s = assigned[q];
      const expected = rules.layout[q];
      const ok = s.cls === expected;
      result.positions[q] = {
        position: q,
        motorId: (rules.motorIds && rules.motorIds[q]) || '',
        expected,
        detected: s.cls,
        confidence: s.confidence,
        bbox: s.box,
        ok
      };
      if (!ok) result.wrong.push(q);
      result.boxes.push({ bbox: s.box, class: s.cls, confidence: s.confidence, color: ok ? 'green' : 'red', position: q });
    }
    if (result.wrong.length) {
      result.state = 'WRONG';
      result.reasonCode = result.wrong.length === QUADRANTS.length ? 'ALL_REVERSED' : 'WRONG_PROP';
      result.allReversed = result.wrong.length === QUADRANTS.length;
    } else {
      result.state = 'CORRECT';
      result.reasonCode = 'OK';
    }
    return result;
  }

  function fill(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (params[key] !== undefined ? params[key] : `{${key}}`));
  }

  /**
   * 把判定結果轉成畫面文字。options.fixed=true 時（上一個穩定狀態是 WRONG、現在轉 CORRECT）顯示「你已經換到正確的了」。
   * 回傳 { tone: 'green'|'red'|'gray', headline, lines: [] }
   */
  function formatJudgement(result, messages, options) {
    const opt = options || {};
    if (result.state === 'CORRECT') {
      return { tone: 'green', headline: opt.fixed ? messages.state.FIXED : messages.state.CORRECT, lines: opt.fixed ? [messages.state.CORRECT] : [] };
    }
    if (result.state === 'WRONG') {
      const lines = result.wrong.map((q) => {
        const p = result.positions[q];
        return fill(messages.wrongItem, {
          position: messages.positions[q],
          expected: messages.classes[p.expected] || p.expected,
          detected: messages.classes[p.detected] || p.detected
        });
      });
      if (result.allReversed) lines.push(messages.allReversedHint);
      return { tone: 'red', headline: messages.state.WRONG, lines };
    }
    const why = messages.uncertainReason[result.reasonCode];
    return { tone: 'gray', headline: messages.state.UNCERTAIN, lines: why ? [why] : [] };
  }

  return { judgePropellers, formatJudgement, iou, QUADRANTS };
});
