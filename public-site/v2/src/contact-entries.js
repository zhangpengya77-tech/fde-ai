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
    // 放在網站整體右上角按鈕列（學員登入等，也是 FDE-GCS 入口所在）的下方，避免互相覆蓋
    '.ct-course{position:absolute;top:84px;right:22px;z-index:5;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(0,194,255,.45);border-radius:12px;background:rgba(7,17,31,.9)}',
    '.ct-course strong{color:#ddf3ff;font-size:14px;margin-right:2px;white-space:nowrap}',
    '.ct-course .ct-btn{padding:6px 10px;font-size:13px}',
    '#programs{position:relative}',
    '[data-guardian][hidden]{display:none!important}',
    '.ct-oa{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 20px;padding:18px 20px;border:1px solid rgba(6,199,85,.55);border-radius:14px;background:rgba(15,32,51,.72)}',
    '.ct-oa h3{margin:0;font-size:18px;color:#fff}',
    '.ct-oa p{margin:4px 0 0;color:#94abc2;font-size:14px;flex-basis:100%;order:3}',
    '.ct-oa-btn{font-size:16px;padding:12px 20px}',
    // 一分鐘影片是直式（9:16）：依原比例置中顯示，不加黑邊
    '.ct-video{margin:20px auto;max-width:360px}',
    '.ct-video video{display:block;width:100%;aspect-ratio:9/16;border-radius:14px;border:1px solid rgba(0,194,255,.35);background:#000}',
    '.ct-video figcaption{margin-top:8px;text-align:center;color:#94abc2;font-size:14px}',
    '.ct-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 20px}',
    '.ct-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:132px;padding:16px 10px;border:1px solid rgba(0,194,255,.35);border-radius:14px;background:linear-gradient(160deg,#0f2033,#07111f);color:#fff;text-decoration:none;text-align:center;position:relative}',
    '.ct-cell:hover,.ct-cell:focus-visible{border-color:#00c2ff;box-shadow:0 0 18px rgba(0,194,255,.25)}',
    '.ct-cell strong{font-size:20px;letter-spacing:.04em}',
    '.ct-cell small{color:#94abc2;font-size:13px}',
    '.ct-no{position:absolute;top:10px;left:14px;color:#00c2ff;font-size:12px;font-weight:700;letter-spacing:.08em}',
    '.ct-contact{margin-top:4px}',
    '@media (max-width:767px){.ct-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ct-cell{min-height:104px}.ct-cell strong{font-size:17px}}',
    // 寬螢幕首頁只顯示 #home 與 #programs-home（programs.css 同樣做法）；聯絡我們區塊也放行
    '@media (min-width:1101px){body.home-view main > section#contact-home{display:block}}',
    '.contact-home{padding:8px clamp(14px,3vw,40px) 48px}',
    // 右下角「加入我們」浮動卡會蓋住內容：寬螢幕保留卡片寬度，手機保留收合按鈕的高度
    '@media (min-width:1101px){.contact-home{padding-right:260px}}',
    '@media (max-width:1100px){.contact-home{padding-bottom:96px}}',
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

  // 網頁版六宮格：與 LINE 圖文選單同樣六個項目（line-oa/rich-menu.json）；網頁上連到站內既有頁面
  var GRID = [
    { no: '01', title: '關於 FDE-AI', sub: '平台介紹・教育理念', href: './about', route: 'about' },
    // 發起人簡介頁經教官確認發布前，先連到「關於我們」（設定 founderUrl 後改連簡介頁）
    { no: '02', title: '發起人簡介', sub: '張鵬亞｜實訓平台發起人', href: C.founderUrl || './about', route: C.founderUrl ? '' : 'about' },
    { no: '03', title: '課程專區', sub: '五大職業實訓課程', href: './programs', route: 'programs' },
    { no: '04', title: '學員成果', sub: '歷屆學員成果', href: './results', route: 'cohorts' },
    { no: '05', title: '課程報名', sub: '線上報名・課程諮詢', href: './programs#pg-consult', route: 'programs', scrollTo: 'pg-consult' },
    { no: '06', title: '考照與預約', sub: '證照・私教・場地諮詢', href: './drone-license', route: 'program-drone-license' }
  ];

  function scrollWhenReady(id, tries) {
    var target = document.getElementById(id);
    if (target && target.offsetParent !== null) {
      target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    if (tries < 40) setTimeout(function () { scrollWhenReady(id, tries + 1); }, 50);
  }

  // A：首頁 LINE 官方帳號 → 一分鐘影片 → 六宮格 → 聯絡我們
  function buildHome() {
    var box = document.getElementById('contactHome');
    if (!box || box.dataset.ready) return;
    box.dataset.ready = '1';

    var oa = el('div', 'ct-oa');
    oa.append(el('h3', '', 'LINE 官方帳號｜FDE-AI 無人載具實訓平台'), el('p', '', '加入官方帳號，接收課程資訊、線上諮詢；在 LINE 裡也能使用下方同樣的六宮格服務選單。'));
    append(oa, C.officialAccountUrl ? link(C.officialAccountUrl, 'ct-btn line ct-oa-btn', '加入 LINE 官方帳號', true) : pending('LINE 官方帳號連結'));
    box.appendChild(oa);

    var fig = el('figure', 'ct-video');
    var video = document.createElement('video');
    video.controls = true;
    video.preload = 'none';            // 按下播放才下載，不拖慢首頁
    video.setAttribute('playsinline', '');
    video.poster = './src/assets/about-intro-poster.jpg';
    video.setAttribute('aria-label', '一分鐘認識 FDE-AI 無人載具實訓平台');
    var source = document.createElement('source');
    source.src = './f450-twin/media/about-intro.mp4';
    source.type = 'video/mp4';
    video.appendChild(source);
    fig.append(video, el('figcaption', '', '▶ 一分鐘認識 FDE-AI 無人載具實訓平台'));
    box.appendChild(fig);

    var grid = el('nav', 'ct-grid');
    grid.setAttribute('aria-label', 'FDE-AI 服務選單');
    GRID.forEach(function (g) {
      var a = link(g.href, 'ct-cell', '', g.external);
      if (g.route) a.dataset.route = g.route;
      // 站內路由不處理 #錨點：切到課程專區後，等表單出現再捲過去
      if (g.scrollTo) a.addEventListener('click', function () { scrollWhenReady(g.scrollTo, 0); });
      a.append(el('span', 'ct-no', g.no), el('strong', '', g.title), el('small', '', g.sub));
      grid.appendChild(a);
    });
    box.appendChild(grid);

    if (!officialOnly) {
      var tel = el('div', 'ct-item ct-contact');
      tel.append(el('h3', '', '聯絡我們'));
      tel.appendChild(el('p', '', C.serviceHours ? '服務時間：' + C.serviceHours : '手機可直接點擊撥號。'));
      if (!C.serviceHours) append(tel, pending('服務時間'));
      tel.appendChild(el('br'));
      tel.appendChild(telLink());
      box.appendChild(tel);
    }
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
