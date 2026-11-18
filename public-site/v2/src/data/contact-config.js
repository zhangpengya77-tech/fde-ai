/*
 * FDE-AI 聯絡入口設定（V4.1，2026-11-18 預覽）
 * 官網三個入口（首頁「聯絡我們」、課程專區右上角「課程報名諮詢」、右下角「加入我們」）都讀這一份設定。
 * 規則：
 *   - 連結一律填真實網址；還沒提供的留空字串，畫面會標「待提供」（預覽模式）或不顯示（正式模式），不得用其他連結頂替。
 *   - mode：'full' 顯示電話與個人 LINE；'official-only' 只顯示 LINE 官方帳號（電話與個人 LINE 全部隱藏）。
 *   - preview：true 時把「待提供」項目標示出來給教師驗收；正式上線前改成 false。
 *   - inquiryMode：'demo' 表單只做前端檢查、不送出任何資料；'live' 送到既有的課程諮詢後端。
 */
window.FdeContact = {
  mode: 'full',
  preview: true,
  phone: '0901189740',
  phoneShow: '0901-189-740',
  serviceHours: '',                 // 待提供：例如「週一至週五 09:00–18:00」
  officialAccountUrl: '',           // 待提供：LINE 官方帳號「加好友」連結（註冊完成後提供）
  personalLineUrl: '',              // 待提供：官網目前只有學習群組連結，找不到個人 LINE 連結
  groupUrl: 'https://line.me/ti/g/jnXbd7PKK8',   // 既有學習群組（沿用 join-us.js 的連結）
  privacyUrl: './privacy/',
  inquiryMode: 'demo'
};
