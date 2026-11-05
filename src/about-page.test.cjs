// 2026-11-05：「關於我們 About FDE-AI」頁驗收測試：導覽改名、路由保留、內容四層、連結都指向既有頁面。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, 'router.js'), 'utf8');

test('關於我們入口在左上角品牌（點我），導航不再有 12 任務地圖，其他項目保留', () => {
  assert.match(html, /<a class="brand-about" href="\.\/about" data-route="about"/, '左上角品牌連到關於我們');
  assert.match(html, /<a class="mobile-menu-brand brand-about" href="\.\/about" data-route="about"/, '手機選單最上方連到關於我們');
  assert.match(html, /class="nav-cta">點我 CLICK/, '有「點我」提示');
  assert.doesNotMatch(app, /title: '12 任務地圖'/, '導航不再顯示 12 任務地圖');
  for (const item of ["label: '健'", "label: '調'", "key: 'cohorts'", "key: 'teacher'", '...moduleSections']) {
    assert.ok(app.includes(item), `保留導航項目 ${item}`);
  }
});

test('路由：新增 /platform/about，原 12 任務 /platform/tasks 與資料保留', () => {
  assert.match(router, /\{ key: 'about', sectionId: 'about', path: 'about' \}/);
  assert.match(router, /\{ key: 'missions', sectionId: 'missions', path: 'tasks' \}/);
  assert.match(html, /<section class="section-block module-page" id="missions">/);
  assert.match(html, /id="missionStageMap"/);
  assert.match(app, /function renderMissionMap\(\)/);
});

test('關於我們頁：四個層次與分開呈現的教學實績', () => {
  const about = html.slice(html.indexOf('id="about"'), html.indexOf('</section>', html.indexOf('id="about"')));
  for (const heading of ['我們是誰？', '我們做什麼？', '我們已經做到了什麼？', '我們可以培養哪些人才？']) assert.ok(about.includes(heading), heading);
  for (const talent of ['職業飛手', '空拍影視人才', '電力／風電巡檢應用人才', '無人機種子教師', '飛控軟硬體工程師', 'AI 無人載具應用與研發人才']) assert.ok(about.includes(talent), talent);
  for (const stage of ['入門', '考照', '實作', '專題', '產業應用', '職涯發展']) assert.ok(about.includes(`<strong>${stage}</strong>`), stage);
  assert.ok(about.includes('並非全部透過 FDE-AI V2.0 平台完成培訓'), '教學實績與平台功能分開，不誇大');
});

test('關於我們頁：所有連結都指向既有真實頁面', () => {
  const about = html.slice(html.indexOf('id="about"'), html.indexOf('</section>', html.indexOf('id="about"')));
  const allowed = new Set(['./courses', './simulator', './f450', './eagle', './results', '/student/growth/', '/live/', '/flight-health/', '/pid-lab/', '/downloads/', '/register/', '/login/']);
  const links = [...about.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 15);
  for (const link of links) assert.ok(allowed.has(link), `連結 ${link} 必須是既有頁面`);
});

test('首頁與右上角入口未被修改', () => {
  assert.match(html, /<a href="\.\/tasks"><span>02<\/span><strong>12 任務<\/strong>/, '首頁「三分鐘看懂」保留');
  for (const entry of ['學員登入', '學員註冊', '教師登入', '下載中心', '仿真訓練']) assert.ok(html.includes(entry), entry);
});
