/**
 * 螺旋槳判定設定載入器（瀏覽器用）：一次讀取規則 JSON 與 i18n 文字，之後重複使用。
 * 圖片上傳與即時鏡頭都從這裡取得同一份規則，確保兩種模式判定一致。
 * 載入失敗時回傳的 Promise 會被拒絕；呼叫端必須顯示「無法判斷」，不得退回其他規則。
 */
(function attachPropLiveConfig(root) {
  let cached = null;
  const BASE = './src/prop-live/';
  const VERSION = 'v=4';

  async function readJson(name) {
    const response = await fetch(`${BASE}${name}?${VERSION}`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`prop_live_config_${response.status}`);
    return response.json();
  }

  function loadPropLiveConfig() {
    if (!cached) {
      cached = Promise.all([readJson('prop-judge-rules.json'), readJson('prop-live.zh-TW.json')])
        .then(([rules, messages]) => ({ rules, messages }))
        .catch((error) => {
          cached = null; // 下次再試，不快取失敗
          throw error;
        });
    }
    return cached;
  }

  root.FdePropLiveConfig = { loadPropLiveConfig };
})(globalThis);
