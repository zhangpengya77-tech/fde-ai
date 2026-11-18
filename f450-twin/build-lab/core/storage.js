// 組裝實訓室｜本機儲存與匯出（第一版只存在瀏覽器本機，不寫任何資料庫）
//
// - 自動儲存：localStorage，鍵名依機型區分；無痕模式或被封鎖時靜默略過，頁面照常運作。
// - 匯出：下載成 JSON 檔；匯入：讀回 JSON 檔交給引擎 restore() 檢查。
// - 存檔內容只有零件安裝狀態、錯誤紀錄與用時，不含學員姓名、帳號等個資。

const PREFIX = 'fde-build-lab:';

export function saveKey(modelId) {
  return `${PREFIX}${modelId}`;
}

/** 寫入本機；成功回傳 true */
export function saveLocal(modelId, data, store = globalThis.localStorage) {
  try {
    store.setItem(saveKey(modelId), JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;   // 無痕模式／空間不足：不影響操作
  }
}

/** 讀取本機；沒有或壞掉回傳 null */
export function loadLocal(modelId, store = globalThis.localStorage) {
  try {
    const raw = store.getItem(saveKey(modelId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearLocal(modelId, store = globalThis.localStorage) {
  try { store.removeItem(saveKey(modelId)); } catch { /* 無痕模式 */ }
}

/** 匯出成檔案（瀏覽器下載），檔名含機型與時間 */
export function exportFile(data, version) {
  const payload = { ...data, appVersion: version, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `build-lab-${data.modelId}-${stamp}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 讀取使用者選的 JSON 檔 */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { try { resolve(JSON.parse(String(reader.result))); } catch (e) { reject(e); } };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
