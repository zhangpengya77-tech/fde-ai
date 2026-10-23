import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 設定。
 *
 * 2026-10-23 起改為跑「build 後的 preview」而非 dev server：
 *  - dev server 的 HMR 會在測試執行中因原始碼變動重載頁面，造成偶發失敗；
 *  - preview 服務的是實際交付的 dist，與教師驗收的版本一致。
 * webServer 會先 build 再 preview；reuseExistingServer=false 確保不會誤用
 * 已在 4173 執行的 dev server。
 */
export default defineConfig({
  testDir: './tests/browser',
  timeout: 90_000,
  /**
   * 斷言預設等待時間。
   *
   * 每個測試都要建立 Three.js 場景 + WebGL context + 抓取 config，並行時首次啟動
   * （`[data-app-status="ready"]`）實測可達 6–8 秒，超過 Playwright 預設 5 秒。
   * 放寬到 20 秒只延長等待上限，不放寬任何斷言條件。
   */
  expect: { timeout: 20_000 },
  /**
   * 單 worker 串行。
   *
   * 本套件 126 個測試幾乎每個都開一個 WebGL context；兩個 worker 並行時 GPU/記憶體
   * 爭用會讓「隨機某幾個測試」在啟動或計時視窗上逾時（實測三輪失敗點都不同，
   * 且每個失敗案例單獨執行必過）。改為串行後結果可重現。
   */
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  outputDir: './.playwright-output',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'off',
    screenshot: 'off',
    /**
     * 反節流（headed Chrome 專用）。
     *
     * 標定嚮導與飛行計時都以 requestAnimationFrame 取樣；Chrome 會把「被其他視窗
     * 遮住的視窗」的 rAF 降頻甚至暫停，導致 `pushAxis` 推桿後偵測不到峰值
     * （實測症狀：`[data-guided-detection]` 一直是空字串、錄製器「未偵測到峰值」）。
     * 這三個旗標只關閉背景節流，不改變任何頁面行為。
     */
    launchOptions: {
      args: [
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
    },
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
