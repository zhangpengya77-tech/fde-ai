// F450 實訓中心｜把成績存到學員的練習紀錄（P6）
// 走既有的 /student/sim-practice/api/（與網頁模擬器同一支）：GET 取得登入狀態與 CSRF，POST 存一筆 mode=f450。
// 學員與班級由後端依登入身分決定；標題、試行標記由後端決定。只送成績摘要，不送操作細節。
const API = '/student/sim-practice/api/';

// 這個網站版本能不能存（本機檔案、GitHub Pages、沒有後端的雲端版都不能）
export async function recordStatus(fetchFn = fetch) {
  if (location.protocol === 'file:' || location.hostname.endsWith('github.io') || location.hostname.endsWith('pages.dev')) return { available: false };
  try {
    const res = await fetchFn(API, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return { available: false };
    const j = await res.json();
    return { available: true, loggedIn: !!j.logged_in, nickname: j.nickname || '', csrf: j.csrf_token, loginUrl: j.login_url || '/login/', recordsUrl: j.records_url || '/student/sim-practice/' };
  } catch { return { available: false }; }
}

// 由成績單結果組出要送的資料（欄位與後端白名單一致）
export function buildPayload(result, { trainMode, seconds, installed, errors }) {
  return {
    mode: 'f450', title: 'F450 組裝接線', score: result.total, duration_seconds: Math.max(0, Math.round(seconds || 0)),
    summary: {
      train_mode: trainMode,
      categories: result.categories.map((c) => ({ id: c.id, score: c.score, max: c.max })),
      installed, wires_correct: result.wiring.correct.length, errors,
    },
  };
}

export async function saveRecord(payload, fetchFn = fetch) {
  const st = await recordStatus(fetchFn);
  if (!st.available) return { saved: false, reason: 'unavailable' };
  if (!st.loggedIn) return { saved: false, reason: 'login', loginUrl: st.loginUrl };
  try {
    const res = await fetchFn(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-CSRFToken': st.csrf }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 201) return { saved: true, recordsUrl: j.records_url || st.recordsUrl };
    if (res.status === 401) return { saved: false, reason: 'login', loginUrl: j.login_url || st.loginUrl };
    return { saved: false, reason: 'error', message: j.detail || `伺服器回應 ${res.status}` };
  } catch { return { saved: false, reason: 'error', message: '教學主機目前連不上，這次成績沒有保存。' }; }
}
