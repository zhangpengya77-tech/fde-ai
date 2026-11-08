// Playwright 設定：即時鏡頭檢測端對端測試（系統 Chrome、假鏡頭餵固定影片）
// 需要環境變數：
//   PROP_LIVE_ONNX   ：ACTIVE 模型轉出的 best.onnx 路徑
//   PROP_LIVE_FRAMES ：測試畫面資料夾（frame_IMG_8415.jpg 正確、frame_IMG_8258.jpg 全反、frame_IMG_8173.jpg 信心不足）
// 測試畫面與模型屬教學資料，不放進 repo。每支假鏡頭影片一個 project（Chrome 啟動參數不同），以標籤分配測試。
import { defineConfig } from '@playwright/test';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = resolve(fileURLToPath(new URL('../../test-results/live-camera/fixtures/', import.meta.url)));

function camera(name, file) {
  return {
    name,
    grep: new RegExp(`@${name}\\b`),
    use: {
      launchOptions: {
        args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${join(FIXTURES, file)}`, '--enable-unsafe-webgpu'],
      },
    },
  };
}

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../../test-results/live-camera/report.json' }]],
  outputDir: '../../test-results/live-camera/artifacts',
  globalSetup: './global-setup.mjs',
  use: {
    channel: 'chrome',
    headless: true,
    baseURL: 'http://127.0.0.1:8030',
    viewport: { width: 1440, height: 1000 },
  },
  projects: [
    camera('correct', 'correct.mjpeg'),
    camera('reversed', 'reversed.mjpeg'),
    camera('uncertain', 'uncertain.mjpeg'),
    camera('fix', 'fix-sequence.mjpeg'),
  ],
  webServer: {
    command: 'node tests/live-camera/mock-server.mjs',
    cwd: '../../',
    url: 'http://127.0.0.1:8030/index.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
