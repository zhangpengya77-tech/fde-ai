// 組裝實訓室｜本機練習／考試紀錄（只存在這台瀏覽器，不上傳、不寫資料庫，不含任何個資）
// 匯出 JSON（完整）與 CSV（給老師用試算表開）。

const KEY = 'fde-build-lab:records';
const MAX = 200;   // 最多保留 200 筆，避免本機儲存空間塞滿

export function listRecords(store = globalThis.localStorage) {
  try {
    const list = JSON.parse(store.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 新增一筆紀錄；回傳是否成功（無痕模式可能失敗，不影響操作） */
export function addRecord(record, store = globalThis.localStorage) {
  try {
    const list = listRecords(store);
    list.push({ ...record, id: record.id || `r${Date.now().toString(36)}` });
    store.setItem(KEY, JSON.stringify(list.slice(-MAX)));
    return true;
  } catch {
    return false;
  }
}

export function clearRecords(store = globalThis.localStorage) {
  try { store.removeItem(KEY); } catch { /* 無痕模式 */ }
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // 防止試算表把開頭是 = + - @ 的內容當公式執行
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** 轉成 CSV（UTF-8 BOM，Excel 開中文才不會亂碼） */
export function recordsToCsv(list) {
  const head = ['完成時間', '機型', '模式', '模擬分數', '是否及格（模擬）', '組裝錯誤次數', '接線錯誤次數', '用時（秒）', '計分規則版本', '教師覆核'];
  const rows = list.map((r) => [
    r.finishedAt, r.modelNameZh, r.modeZh, r.score, r.pass ? '是' : '否', r.assemblyErrors, r.wiringErrors,
    Math.round((r.elapsedMs || 0) / 1000), r.rulesVersion, r.reviewStatus,
  ]);
  return '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
