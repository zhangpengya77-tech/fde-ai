/*
 * FDE-AI 平台左側導航｜附加項目設定（2026-11-17）
 * - app.js 的 renderNavigation 會把 before 放在「學練做測證」前面、after 放在最後面。
 * - 其他專案（例如 FDE-GCS 地面站）要新增導航時只改這個檔案，不要改 app.js，避免互相衝突。
 * - key 對應 src/router.js 的路由；也可以用 href 指向站內其他頁面。label 是徽章上的單字，en 是徽章下方英文。
 */
window.FdeNavConfig = {
  before: [
    { key: 'home', label: '首', en: 'HOME', title: '首頁' },
    { key: 'about', label: '識', en: 'ABOUT', title: '一分鐘認識 FDE-AI' },
    { key: 'programs', label: '課', en: 'COURSES', title: '課程開設' },
  ],
  after: [],
};
