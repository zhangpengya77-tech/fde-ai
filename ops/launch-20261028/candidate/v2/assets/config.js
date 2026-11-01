/* 公開站只保存教學後台 URL，不保存帳密、Cookie 或任何私有金鑰。 */
window.FDE_PUBLIC_CONFIG = Object.freeze({
  // 教學後台 HTTPS 入口（Cloudflare Worker Gateway；2026-10-28 實測 /login/ 200、/teacher/login/ 200）。
  portalBaseUrl: "https://fde-ai-gateway.fde-ai-gateway.workers.dev",
  // 匿名、唯讀、不含敏感資訊的狀態端點。
  // 現況：Worker /gateway-status 已存在並回 {"gateway":"online","classroom_server":bool}，
  // 但尚未回傳 Access-Control-Allow-Origin，跨網域讀取會被瀏覽器阻擋。
  // 在此期間前端誠實降級為「無法確認」，不假裝可用。
  portalStatusUrl: "https://fde-ai-gateway.fde-ai-gateway.workers.dev/gateway-status",
  // 可選：若後續提供含 vision 欄位的匿名健康端點（例如 /api/public/health/），填入後即可顯示 YOLO 真實狀態。
  visionStatusUrl: "",
  // 狀態查詢逾時（毫秒）。
  statusTimeoutMs: 4000
});
