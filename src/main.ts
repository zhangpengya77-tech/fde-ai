import './styles.css';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('App root was not found.');
}

const params = new URLSearchParams(window.location.search);
if (params.get('mode') === 'exam') {
  // CAA 專業基本級術科考場模擬（考試機獨立疊加）。
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
