/*
 * FDE-AI 平台左側導航｜附加項目設定（2026-11-17 起；11-18 改版）
 * - featured：放在導航最上方、獨立成一張寬版主推卡片（目前是「課程專區」），與下方系統區塊分開。
 * - systemLabel：主推卡片與「學練做測證健」系統區塊之間的小標題。
 * - before／after：放在「學練做測證」前面／最後面、沿用圓形徽章樣式的附加項目（目前沒有）。
 * - 其他專案（例如 FDE-GCS 地面站）要新增導航時只改這個檔案，不要改 app.js，避免互相衝突。
 * - key 對應 src/router.js 的路由；也可以用 href 指向站內其他頁面。
 */
window.FdeNavConfig = {
  featured: [
    { key: 'programs', title: '課程專區', subtitle: '課程介紹與報名', en: 'COURSES' },
  ],
  systemLabel: { title: '學習系統', en: 'LEARN · PRACTICE · BUILD · TEST · CERTIFY' },
  before: [],
  after: [],
};
