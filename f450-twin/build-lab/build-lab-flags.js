// 組裝實訓室（R2.1）功能開關。
// entryVisible：網站上是否顯示新版入口。預設 false＝網站任何地方都看不到入口，只能直接開網址預覽。
// 等教師檢查並批准後才改成 true；舊版數位孿生的隱藏也另外由批准後處理（隱藏不刪除，可回復）。
export const BUILD_LAB_FLAGS = Object.freeze({
  entryVisible: false,
  // 版本號：顯示在頁首，也寫進匯出的紀錄檔，方便追查
  version: 'R2.1-P2',
});
