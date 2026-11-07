// 線上驗收：直接對 GitHub Pages 正式網址跑 REA 測試（不啟動本機伺服器）
import base from './playwright.config';
import { defineConfig } from '@playwright/test';
export default defineConfig({ ...base, testDir: './tests/live', webServer: undefined });
