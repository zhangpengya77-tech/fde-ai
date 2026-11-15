// FDE-AI 公開首頁｜右下角「加入我們」浮動卡（2026-11-15）
// 電腦：右下角顯示 LINE 群 QR 碼、「加入我們」與聯繫教師電話，可收合成小按鈕。
// 手機：預設只顯示小按鈕（不擋內容），點開後可直接用 LINE 加入群組或撥電話。
// 收合狀態存在瀏覽器本機（無痕模式存不了也照常運作）。
(function () {
  'use strict';
  var LINE_URL = 'https://line.me/ti/g/jnXbd7PKK8';   // QR 碼內容（LINE 群邀請連結）
  var PHONE = '0901189740', PHONE_SHOW = '0901-189-740';
  var KEY = 'fde-joinus-collapsed';
  // QR 圖片放在這支程式旁邊（GitHub 頁面與教師電腦的平台路徑不同，用程式自己的位置找）
  var QR = (document.currentScript && document.currentScript.src) ? new URL('line-group-qr.png', document.currentScript.src).href : './src/line-group-qr.png';

  var css = [
    '.joinus{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:60;font-family:Arial,"Microsoft JhengHei","PingFang TC",sans-serif;color:#e8f6ff}',
    '.joinus-card{width:212px;padding:14px 14px 12px;border:1px solid rgba(0,194,255,.55);border-radius:16px;background:rgba(6,18,32,.94);box-shadow:0 0 0 1px rgba(0,194,255,.15),0 12px 32px rgba(0,0,0,.45),0 0 24px rgba(0,194,255,.18);backdrop-filter:blur(6px);text-align:center;position:relative}',
    '.joinus-card h3{margin:0 0 8px;font-size:18px;letter-spacing:.08em;color:#00c2ff}',
    '.joinus-qr{display:block;width:168px;height:168px;margin:0 auto;border-radius:10px;background:#fff;padding:6px;box-sizing:content-box}',
    '.joinus-note{margin:8px 0 6px;font-size:13px;color:#9fc4dc}',
    '.joinus-line{display:none;margin:6px 0;padding:10px 12px;border-radius:10px;background:#06c755;color:#fff;font-weight:700;text-decoration:none}',
    '.joinus-tel{display:block;margin-top:4px;padding:8px 6px;border-radius:10px;border:1px solid rgba(0,194,255,.45);color:#e8f6ff;text-decoration:none;font-size:14px}',
    '.joinus-tel b{color:#3ddc97;font-size:16px;letter-spacing:.03em}',
    '.joinus-x{position:absolute;top:6px;right:8px;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:#9fc4dc;font-size:18px;cursor:pointer}',
    '.joinus-x:hover{background:rgba(0,194,255,.15);color:#fff}',
    '.joinus-pill{display:none;align-items:center;gap:8px;padding:12px 16px;border:1px solid rgba(0,194,255,.6);border-radius:999px;background:rgba(6,18,32,.94);color:#e8f6ff;font:inherit;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.45),0 0 18px rgba(0,194,255,.25)}',
    '.joinus-pill i{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;background:#06c755;color:#fff;font-style:normal;font-size:11px;font-weight:800}',
    '.joinus.collapsed .joinus-card{display:none}.joinus.collapsed .joinus-pill{display:inline-flex}',
    '@media (max-width:767px){.joinus-card{width:230px}.joinus-qr{width:140px;height:140px}.joinus-line{display:block}}',
    '@media print{.joinus{display:none}}'
  ].join('\n');

  function build() {
    if (document.querySelector('.joinus')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var box = document.createElement('aside');
    box.className = 'joinus'; box.setAttribute('aria-label', '加入我們');
    box.innerHTML =
      '<div class="joinus-card">' +
        '<button type="button" class="joinus-x" aria-label="收合">×</button>' +
        '<h3>加入我們</h3>' +
        '<img class="joinus-qr" src="' + QR + '" width="168" height="168" alt="FDE-AI LINE 群組 QR 碼">' +
        '<p class="joinus-note">LINE 掃碼加入學習群組</p>' +
        '<a class="joinus-line" href="' + LINE_URL + '" target="_blank" rel="noopener">用 LINE 加入群組</a>' +
        '<a class="joinus-tel" href="tel:' + PHONE + '">聯繫教師<br><b>' + PHONE_SHOW + '</b></a>' +
      '</div>' +
      '<button type="button" class="joinus-pill" aria-label="加入我們：LINE 群組與聯繫教師"><i>LINE</i>加入我們</button>';
    document.body.appendChild(box);
    var saved = null; try { saved = localStorage.getItem(KEY); } catch (e) { /* 無痕模式 */ }
    var small = window.matchMedia('(max-width: 767px)').matches;
    box.classList.toggle('collapsed', saved === null ? small : saved === '1');   // 手機預設收合，電腦預設展開
    function set(c) { box.classList.toggle('collapsed', c); try { localStorage.setItem(KEY, c ? '1' : '0'); } catch (e) { /* 無痕模式 */ } }
    box.querySelector('.joinus-x').onclick = function () { set(true); };
    box.querySelector('.joinus-pill').onclick = function () { set(false); };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
