import { defineConfig } from 'vite';

export default defineConfig({
  // 相对 base：产物可挂载到任意子路径（如 v2.0 后端的 /sim/），也可本地独立运行
  base: './',
  // 2026-11-07：多頁建置——模擬器主頁 index.html ＋ 手機遙控器頁 phone.html
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        phone: 'phone.html',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
