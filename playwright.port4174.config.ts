// 回歸測試用：與預設設定完全相同，只把預覽埠改成 4174（避免與殘留的 4173 衝突）
import base from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:4174' },
  webServer: { ...(base.webServer as object), command: 'npm run build && npm run preview -- --port 4174 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4174/' },
});
