/**
 * 練飛成績自動存入成長日誌（2026-11-07）
 *
 * 模擬器在教學網站（同網域的 /sim/app/）上執行時：
 *   1. GET /student/sim-practice/api/ → 知道是否已登入學員，並取得 CSRF token（防跨站偽造）
 *   2. 已登入 → POST 成績摘要（分數、等第、通過與否、飛行時間、操作方式）
 *   3. 未登入 → 不送出，畫面提示「登入後成績會自動存入成長日誌」
 * 放在 GitHub 頁面（github.io）時沒有登入身分，只提示改到教學網站練習才會保存。
 * 只送成績摘要，不送影像、照片或飛行軌跡。
 */
import { FIXED_ENTRY } from '../input/phone/simlink-client';

export interface PracticeRecord {
  mode: 'inspection' | 'exam';
  title: string;
  score?: number | null;
  grade?: string;
  passed?: boolean | null;
  duration_seconds: number;
  input_source: string;
  summary?: Record<string, unknown>;
}

export type PracticeSyncResult =
  | { saved: true; recordsUrl: string }
  | { saved: false; reason: 'login'; loginUrl: string }
  | { saved: false; reason: 'pages'; siteUrl: string }
  | { saved: false; reason: 'error'; message: string };

const API_PATH = '/student/sim-practice/api/';
const KNOWN_SOURCES = new Set(['鍵盤', '實體遙控器', '手機遙控器', '原子筆（鏡頭）', '手勢（鏡頭）']);

/** 輸入來源顯示名稱 → 成績紀錄用的操作方式（USB 遙控器的型號名稱一律記為「實體遙控器」） */
export function normalizeInputSource(kind: 'keyboard' | 'adapter', label: string): string {
  if (kind === 'keyboard') return '鍵盤';
  return KNOWN_SOURCES.has(label) ? label : '實體遙控器';
}

export async function syncPractice(record: PracticeRecord, fetchImpl: typeof fetch = fetch): Promise<PracticeSyncResult> {
  if (typeof location !== 'undefined' && location.hostname.endsWith('github.io')) {
    return { saved: false, reason: 'pages', siteUrl: `${FIXED_ENTRY}/sim/` };
  }
  try {
    const info = (await (await fetchImpl(API_PATH, { credentials: 'same-origin', cache: 'no-store' })).json()) as {
      logged_in: boolean;
      csrf_token: string;
      login_url: string;
    };
    if (!info.logged_in) return { saved: false, reason: 'login', loginUrl: info.login_url };
    const res = await fetchImpl(API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'X-CSRFToken': info.csrf_token },
      body: JSON.stringify(record),
    });
    const body = (await res.json().catch(() => ({}))) as { records_url?: string; detail?: string; login_url?: string };
    if (res.status === 201) return { saved: true, recordsUrl: body.records_url ?? '/student/sim-practice/' };
    if (res.status === 401) return { saved: false, reason: 'login', loginUrl: body.login_url ?? '/login/' };
    return { saved: false, reason: 'error', message: body.detail ?? `伺服器回應 ${res.status}` };
  } catch {
    // 本機開發（沒有後台）或主機離線：不影響練習本身
    return { saved: false, reason: 'error', message: '教學主機目前連不上，這次成績沒有保存。' };
  }
}

/** 左下角小提示：告訴學員成績有沒有存進成長日誌 */
export function showPracticeToast(result: PracticeSyncResult): void {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText =
    'position:fixed;left:12px;bottom:60px;z-index:60;max-width:min(420px,calc(100vw - 24px));padding:10px 14px;border-radius:10px;' +
    'background:#0b1520f2;color:#e6f2fa;border:1px solid #2fb4ff88;font:14px/1.6 system-ui,"Microsoft JhengHei",sans-serif;box-shadow:0 8px 30px #0008';
  const link = (href: string, text: string): string => `<a href="${href}" target="_blank" rel="noopener" style="color:#5fd4ff;font-weight:700">${text}</a>`;
  el.innerHTML = result.saved
    ? `✅ 成績已存入成長日誌　${link(result.recordsUrl, '查看練飛紀錄')}`
    : result.reason === 'login'
      ? `💡 登入學員帳號後，練飛成績會自動存入成長日誌　${link(result.loginUrl, '登入')}`
      : result.reason === 'pages'
        ? `💡 這裡是公開網站，成績不會保存；到教學網站登入後練習即可保存　${link(result.siteUrl, '前往')}`
        : `⚠️ ${result.message}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}
