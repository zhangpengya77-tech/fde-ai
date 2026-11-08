// vitest 設定：只跑即時鏡頭檢測的單元測試（tests/live-camera/unit）；既有 node --test 測試不受影響
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/live-camera/unit/**/*.test.mjs'],
    environment: 'node',
  },
});
