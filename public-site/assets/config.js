/* 公開站只保存教學後台 URL，不保存帳密、Cookie 或任何私有金鑰。 */
window.FDE_PUBLIC_CONFIG = Object.freeze({
  // 正式 Named Tunnel／Gateway 完成後，在發布流程中填入 HTTPS 教學後台網址。
  portalBaseUrl: "",
  // 可選的匿名狀態端點；未設定時公開站安全地顯示離線。
  portalStatusUrl: ""
});
