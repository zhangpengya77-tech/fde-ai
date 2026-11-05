/* 公開站只保存教學後台 URL，不保存帳密、Cookie 或任何私有金鑰。 */
window.FDE_PUBLIC_CONFIG = Object.freeze({
  // 正式 Named Tunnel／Gateway 完成後，在發布流程中填入 HTTPS 教學後台網址。
  // 留空時，學員登入、註冊、教師後台與成長日誌等動態入口會誠實顯示「需教學系統上線」，不產生假結果。
  // 2026-11-04：教學後台目前經 Cloudflare 臨時通道對外（主機重開機後網址會變，需重新發布）。
  portalBaseUrl: "https://traditional-growing-beach-pads.trycloudflare.com",
  // 可選的匿名狀態端點；未設定時公開站安全地顯示離線。
  portalStatusUrl: "",
  // 視覺推論（鷹眼 AI 檢測）後端基址；留空時檢測功能離線，不呼叫本機服務、不產生假結果。
  visionApiUrl: "",
  // 語音助教後端基址；留空時語音功能離線。
  voiceApiUrl: ""
});
