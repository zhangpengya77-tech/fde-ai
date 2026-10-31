/**
 * FDE Flight Health AI - 集中環境配置 (V3)
 * 嚴格解耦開發與生產環境 API
 */
window.FLIGHT_HEALTH_CONFIG = {
  // 本機開發環境：直連教師主機 FastAPI (:8040)
  API_BASE_LOCAL: "",

  // 正式環境佔位配置：暫未配置 Cloudflare Tunnel 時保持為空字串
  // 規範：未來在 Cloudflare 配置同域轉發後，才填寫 "/api/flight-health/v1"
  API_BASE_PROD: "",

  // 連線健康檢查逾時（毫秒）
  PROBE_TIMEOUT_MS: 2000,

  /**
   * 取得當前環境生效的 API Base URL
   *
   * 優先順序：
   * 1. loopback（localhost / 127.0.0.1）→ API_BASE_LOCAL（留空時視為未配置）
   * 2. RFC 1918 私有 IP（區網手機預覽）→ http://{hostname}:8040/api/v1
   * 3. 正式環境已配置 API_BASE_PROD → API_BASE_PROD
   * 4. 未配置 → null（顯示「服務尚未配置」提示）
   *
   * @returns {string|null}
   */
  getActiveApiBase: function () {
    const hostname = window.location.hostname;

    // 1. loopback
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return this.API_BASE_LOCAL || null;
    }

    // 2. RFC 1918 區網 IP（手機 LAN 預覽）
    //    192.168.x.x / 10.x.x.x / 172.16-31.x.x
    const isLAN =
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);

    if (isLAN) {
      // 使用頁面 hostname + 8040，確保手機和電腦指向同一台主機
      return `http://${hostname}:8040/api/v1`;
    }

    // 3. 正式環境（GitHub Pages / 自訂網域）
    if (this.API_BASE_PROD && this.API_BASE_PROD.trim() !== "") {
      return this.API_BASE_PROD;
    }

    // 4. 尚未配置
    return null;
  }
};
