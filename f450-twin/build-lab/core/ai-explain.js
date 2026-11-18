// 組裝實訓室｜AI 講解（P4）
//
// 原則：
// 1. AI 只負責「解釋」零件用途與接線原理；對錯一律由規則引擎判定，AI 不得推翻或重新判斷。
// 2. 送出的內容只有零件名稱、接線步驟與錯誤代碼，不含學員姓名、帳號或任何個資。
// 3. 走網站既有的 FDE 知識庫 /api/rag/ask；連不上、拒答或逾時時，顯示固定說明，不影響操作。
// 4. 考試模式不提供 AI 講解。

/** 零件用途的提問 */
export function partQuestion(modelNameZh, part) {
  return `無人機組裝教學（${modelNameZh}）：請用 2～3 句、國中生聽得懂的話，說明「${part.nameZh}」（${part.model}）的用途，以及安裝時最容易犯的錯誤。只說明原理，不要評分。`;
}

/** 接線錯誤原理的提問；明確要求不得改變判定 */
export function wiringErrorQuestion(modelNameZh, step, result) {
  return `無人機接線教學（${modelNameZh}）：學員在「${step.titleZh}」這一步被規則判定為「${result.code}」。系統說明：${result.messageZh}`
    + ' 請用 2～3 句補充背後的電學或通訊原理，幫助學員理解為什麼正確做法是：' + `${result.fixZh}`
    + ' 判定結果已由規則決定，不要重新判斷對錯，也不要推測其他接法。';
}

/**
 * 呼叫知識庫。成功回傳 { ok: true, answer, sourceType }；失敗回傳 { ok: false }（呼叫端顯示固定說明）。
 * @param {string} question
 * @param {{ fetchImpl?: Function, endpoint?: string, timeoutMs?: number }} [opts]
 */
export async function askAI(question, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const endpoint = opts.endpoint || '/api/rag/ask';
  const timeoutMs = opts.timeoutMs || 20000;
  if (typeof fetchImpl !== 'function' || !String(question || '').trim()) return { ok: false };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },   // 與網站既有 rag-client 相同格式
      body: JSON.stringify({ question }),
      signal: controller?.signal,
    });
    if (!res?.ok) return { ok: false };
    const data = await res.json();
    const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
    if (!answer || data.source_type === 'refuse') return { ok: false };
    return { ok: true, answer, sourceType: data.source_type || '' };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
