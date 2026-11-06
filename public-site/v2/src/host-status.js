// 2026-11-06：主機在線偵測（GitHub 頁面靜態站用）
// 架構：GitHub 頁面永遠在線（公開課程、關於我們、介紹影片、數位孿生都能看）；
//       註冊、登入、上傳、AI 檢測、AI 陪做等「互動功能」由教師電腦（主機）提供。
// 做法：每 60 秒（以及切回這個分頁時）向主機要一張小圖片：
//   - 載得到 → 主機在線：互動按鈕正常可用，頁面上方顯示綠燈「主機在線」
//   - 載不到 → 主機離線：互動按鈕變淡，按下時跳出提示（不會跑到錯誤頁），顯示灰燈「主機離線」
// 不需要後台額外程式；主機開機後最多 60 秒自動恢復，不用重新整理。
(() => {
  const cfg = window.FDE_PUBLIC_CONFIG || {};
  const base = (cfg.portalBaseUrl || '').replace(/\/+$/, '');
  // 比照 V1.5C「匿名狀態檢查」：直接問 Django 教學後台（註冊、登入都在這裡），不帶任何帳密或 Cookie
  const PING_PATH = '/static/admin/img/icon-addlink.svg';
  const TIMEOUT_MS = 8000;
  const INTERVAL_MS = 60000;
  let online = null;

  // ── 頁面上方的狀態燈 ──
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'host-status host-status--checking';
  pill.setAttribute('aria-live', 'polite');
  pill.textContent = '● 正在確認主機狀態…';
  pill.addEventListener('click', () => { check(); if (online === false) toast(); });
  document.body.appendChild(pill);

  // ── 離線提示（按下需要主機的按鈕時顯示）──
  const box = document.createElement('div');
  box.className = 'host-toast';
  box.hidden = true;
  box.setAttribute('role', 'alert');
  box.innerHTML = '<b>目前離線</b><span>教師主機尚未開機。你可以先瀏覽公開課程、關於我們與介紹影片；<br>註冊、登入、上傳與 AI 檢測會在主機開機後自動開放。</span><button type="button">知道了</button>';
  box.querySelector('button').addEventListener('click', () => { box.hidden = true; });
  document.body.appendChild(box);
  let toastTimer = null;
  function toast() {
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 7000);
  }

  // 需要主機的連結：網址指向主機，或已被標成「需教學系統上線」的入口
  function hostLinks() {
    return [...document.querySelectorAll('a')].filter((a) => {
      const href = a.getAttribute('href') || '';
      return (base && href.startsWith(base)) || a.classList.contains('portal-link-disabled') || a.hasAttribute('data-backend-path');
    });
  }

  function apply(state) {
    online = state;
    document.body.classList.toggle('host-offline', !state);
    document.body.classList.toggle('host-online', state);
    pill.className = 'host-status ' + (state ? 'host-status--online' : 'host-status--offline');
    pill.textContent = state ? '● 主機在線：註冊、登入、上傳、AI 檢測都可使用' : '● 主機離線：可看公開課程，互動功能於主機開機後開放';
    hostLinks().forEach((a) => {
      a.dataset.needsHost = '1';
      if (state) { a.removeAttribute('aria-disabled'); } else { a.setAttribute('aria-disabled', 'true'); }
    });
  }

  // 離線時攔下互動按鈕的點擊，改顯示提示
  document.addEventListener('click', (ev) => {
    if (online !== false) return;
    const a = ev.target.closest('a');
    if (a && a.dataset.needsHost === '1') { ev.preventDefault(); ev.stopPropagation(); toast(); }
  }, true);

  function check() {
    if (!base) { apply(false); return; }
    const img = new Image();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); apply(ok); };
    const timer = setTimeout(() => finish(false), TIMEOUT_MS);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = `${base}${PING_PATH}?ping=${Date.now()}`;
  }

  // 頁面路由切換後連結會重畫：每次確認狀態時重新標記
  const start = () => { check(); setInterval(check, INTERVAL_MS); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
  // 給測試用：可強制切換（例如 FdeHostStatus.set(false)）
  window.FdeHostStatus = { check, set: apply, get: () => online };
})();
