import './styles.css';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('App root was not found.');
}

const params = new URLSearchParams(window.location.search);
if (params.get('mode') === 'exam') {
  // 2026-11-07：正式考照入口改為 REA 重建版（選科目 → 選機型 → 設定 → 開始飛 → 評等／回放）。
  // 下方五種連線方式沿用 ExamInput 與既有連線面板。
  void import('./rea/app').then((m) => {
    const app = m.createReaApp(root);
    if (import.meta.hot) {
      import.meta.hot.dispose(() => app.dispose());
    }
  });
} else if (params.get('mode') === 'exam-legacy') {
  // 舊版 F450 考照模擬器：保留為歷史版本，不再作為正式考照入口。
  void import('./exam/exam-app').then((m) => {
    const examMode = params.get('exam') !== '0';
    const app = m.createExamApp(root, { examMode });
    if (import.meta.hot) {
      import.meta.hot.dispose(() => app.dispose());
    }
  });
} else if (params.get('mode') === 'penta') {
  // 科目 E（高度保持五邊飛行）教學預覽（獨立疊加，不接評分）。
  void import('./exam/penta-app').then((m) => {
    const app = m.createPentaApp(root);
    if (import.meta.hot) {
      import.meta.hot.dispose(() => app.dispose());
    }
  });
} else {
  void import('./app/create-app').then((m) => {
    const app = m.createApp(root);
    if (import.meta.hot) {
      import.meta.hot.dispose(() => app.dispose());
    }
  });
}
