/**
 * 即時鏡頭問答（純邏輯，可在 node 測試）：學員不發問時不講話；發問時依「穩定後的判定」回答對錯與正確答案。
 *
 * createAsker({ askRag, messages, rules }) → { ask(question, stableInfo) }
 *   stableInfo：穩定化模組的 { stable, signature, fixed }（stable 可能為 null＝還在判斷中）
 *   回傳 Promise<{ kind, ruleText, ragText, speech }>
 *     kind：'judging' | 'correct' | 'wrong' | 'uncertain'
 *
 * 原則：
 *   - 對錯一律由規則判定（judgePropellers＋穩定化）決定，AI／知識庫只做補充，不得改變對錯。
 *   - 只有 WRONG 才呼叫知識庫（RAG），而且同一個錯誤狀態只呼叫一次（重複發問使用同一份補充）。
 *   - 無法判斷、還在判斷中、正確 → 不呼叫知識庫，避免 AI 自行推測。
 *   - 知識庫失敗或逾時 → 只回答規則文字。
 */
(function attachPropQa(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FdePropQa = api;
})(globalThis, function createPropQaModule() {
  const QUADRANTS = ['TL', 'TR', 'BL', 'BR'];

  function fill(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (params[key] !== undefined ? params[key] : ''));
  }

  /** 正確裝法文字由設定檔 layout 組出，不寫死。 */
  function layoutText(rules, messages) {
    return QUADRANTS.map((q) => `${messages.positions[q]} ${rules.layout[q]}`).join('、');
  }

  function wrongLines(stable, messages) {
    return stable.wrong.map((q) => fill(messages.wrongItem, {
      position: messages.positions[q], expected: stable.positions[q].expected, detected: stable.positions[q].detected,
    }));
  }

  function buildRuleAnswer(stableInfo, messages, rules) {
    const qa = messages.qa;
    const stable = stableInfo && stableInfo.stable;
    if (!stable) return { kind: 'judging', text: qa.judging };
    const layout = fill(qa.layoutAnswer, { layout: layoutText(rules, messages) });
    if (stable.state === 'CORRECT') {
      const head = stableInfo.fixed ? messages.state.FIXED : messages.state.CORRECT;
      return { kind: 'correct', text: `${qa.yes}${head}` };
    }
    if (stable.state === 'WRONG') {
      const lines = wrongLines(stable, messages);
      if (stable.allReversed) lines.push(messages.allReversedHint);
      return { kind: 'wrong', text: [qa.no, ...lines, layout].join('') };
    }
    const why = messages.uncertainReason[stable.reasonCode];
    return { kind: 'uncertain', text: [messages.state.UNCERTAIN, why || ''].join('') };
  }

  function buildRagQuestion(question, stable, messages, rules) {
    return fill(messages.qa.ragQuestion, {
      question: String(question || '').trim() || messages.qa.defaultQuestion,
      wrong: wrongLines(stable, messages).join(''),
      layout: layoutText(rules, messages),
    });
  }

  function createAsker({ askRag, messages, rules, timeoutMs }) {
    const cache = new Map(); // 簽章 → Promise<補充文字|null>
    const limit = Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000;

    function supplement(signature, question, stable) {
      if (!cache.has(signature)) {
        const call = Promise.race([
          Promise.resolve().then(() => askRag(buildRagQuestion(question, stable, messages, rules))),
          new Promise((resolve) => setTimeout(() => resolve(null), limit)),
        ]).then((result) => {
          const text = result && typeof result.answer === 'string' ? result.answer.trim() : '';
          return text || null;
        }).catch(() => null);
        cache.set(signature, call);
      }
      return cache.get(signature);
    }

    async function ask(question, stableInfo) {
      const rule = buildRuleAnswer(stableInfo, messages, rules);
      let ragText = null;
      if (rule.kind === 'wrong' && typeof askRag === 'function') {
        ragText = await supplement(stableInfo.signature, question, stableInfo.stable);
      }
      const speech = ragText ? `${rule.text}${messages.qa.ragLabel}：${ragText}` : rule.text;
      return { kind: rule.kind, ruleText: rule.text, ragText, speech };
    }

    return { ask, ragCalls: () => cache.size };
  }

  return { createAsker, buildRuleAnswer, buildRagQuestion, layoutText };
});
