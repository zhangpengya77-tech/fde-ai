/*
 * FDE-AI 聯絡入口（V4.1，2026-11-18 預覽）
 * A：首頁「聯絡我們」區塊（#contactHome）：LINE 官方帳號入口＋電話（點擊撥號）＋服務時間。
 * B：課程專區右上角「課程報名諮詢」：個人 LINE＋電話，分別可點擊（不使用官方帳號連結，除非 mode 改成 official-only）。
 * C：右下角「加入我們」沿用既有 join-us.js，不在這裡重做。
 * 設定全部來自 src/data/contact-config.js；連結未提供時不顯示假連結。
 */
(function () {
  'use strict';
  var C = window.FdeContact;
  if (!C) return;
  var officialOnly = C.mode === 'official-only';

  var css = [
    '.ct-home{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:18px}',
    '.ct-item{padding:18px 20px;border:1px solid rgba(0,194,255,.35);border-radius:14px;background:rgba(15,32,51,.72)}',
    '.ct-item h3{margin:0 0 8px;font-size:17px;color:#00c2ff;letter-spacing:.04em}',
    '.ct-item p{margin:0 0 10px;color:#94abc2;font-size:14px;line-height:1.6}',
    '.ct-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;border:1px solid rgba(0,194,255,.6);color:#ddf3ff;text-decoration:none;font-weight:700;font-size:15px}',
    '.ct-btn:hover,.ct-btn:focus-visible{border-color:#00c2ff;background:rgba(0,194,255,.12)}',
    '.ct-btn.line{background:#06c755;border-color:#06c755;color:#fff}',
    '.ct-tel b{color:#35e6a8;letter-spacing:.03em}',
    '.ct-pending{display:inline-block;padding:8px 12px;border-radius:10px;border:1px dashed #ff5c73;color:#ff9aa9;font-size:13px}',
    '.ct-course{position:absolute;top:18px;right:22px;z-index:5;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(0,194,255,.45);border-radius:12px;background:rgba(7,17,31,.9)}',
    '.ct-course strong{color:#ddf3ff;font-size:14px;margin-right:2px;white-space:nowrap}',
    '.ct-course .ct-btn{padding:6px 10px;font-size:13px}',
    '#programs{position:relative}',
    '[data-guardian][hidden]{display:none!important}',
    '.pg-demo{padding:8px 12px;border:1px dashed rgba(0,194,255,.6);border-radius:10px;color:#ddf3ff}',
    '@media (max-width:767px){.ct-course{position:static;flex-wrap:wrap;margin:0 0 12px}}'
  ].join('\n');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }
  function link(href, cls, text, external) {
    var a = el('a', cls, text);
    a.href = href;
    if (external) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }
  function pending(text) { return C.preview ? el('span', 'ct-pending', text + '（待提供）') : null; }
  function telLink(cls) {
    var a = link('tel:' + C.phone, 'ct-btn ct-tel ' + (cls || ''), '');
    a.append('來電 ', el('b', '', C.phoneShow));
    return a;
  }
  function append(parent, child) { if (child) parent.appendChild(child); }

  // A：首頁「聯絡我們」
  function buildHome() {
    var box = document.getElementById('contactHome');
    if (!box || box.dataset.ready) return;
    box.dataset.ready = '1';
    var grid = el('div', 'ct-home');

    var oa = el('article', 'ct-item');
    oa.append(el('h3', '', 'LINE 官方帳號'), el('p', '', '加入 FDE-AI 無人載具實訓平台官方帳號，接收課程資訊、線上諮詢。'));
    append(oa, C.officialAccountUrl ? link(C.officialAccountUrl, 'ct-btn line', '加入 LINE 官方帳號', true) : pending('LINE 官方帳號連結'));
    grid.appendChild(oa);

    if (!officialOnly) {
      var tel = el('article', 'ct-item');
      tel.append(el('h3', '', '電話聯絡'));
      tel.appendChild(el('p', '', C.serviceHours ? '服務時間：' + C.serviceHours : '手機可直接點擊撥號。'));
      if (!C.serviceHours) append(tel, pending('服務時間'));
      tel.appendChild(el('br'));
      tel.appendChild(telLink());
      grid.appendChild(tel);
    }
    box.appendChild(grid);
  }

  // B：課程專區右上角「課程報名諮詢」
  function buildCourse() {
    var section = document.getElementById('programs');
    if (!section || section.querySelector('.ct-course')) return;
    var bar = el('div', 'ct-course');
    bar.setAttribute('aria-label', '課程報名諮詢');
    bar.appendChild(el('strong', '', '課程報名諮詢'));
    if (officialOnly) {
      append(bar, C.officialAccountUrl ? link(C.officialAccountUrl, 'ct-btn line', 'LINE 官方帳號', true) : pending('LINE 官方帳號'));
    } else {
      append(bar, C.personalLineUrl ? link(C.personalLineUrl, 'ct-btn line', 'LINE 諮詢', true) : pending('個人 LINE'));
      bar.appendChild(telLink());
    }
    section.insertBefore(bar, section.firstChild);
  }

  function build() {
    var st = el('style'); st.textContent = css; document.head.appendChild(st);
    buildHome();
    buildCourse();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
