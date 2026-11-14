/**
 * FDE 空域查詢主程式（自行撰寫）。
 * 資料：交通部民用航空局 遙控無人機管理資訊系統 公開圖層（dronegis.caa.gov.tw，ArcGIS 伺服器）。
 *   民航局伺服器提供 JSONP（伺服器回傳 callback(...) 的公開跨站讀取方式），本頁由訪客瀏覽器即時查詢，資料永遠最新。
 * 功能：
 *  1. 點地圖／搜尋地名或座標／定位 → 查該點落在哪些管制區，結果卡片依紅／黃／紫／藍／綠五種狀態顯示。
 *  2. 依查詢點經緯度計算當天日出日落；以台北時間每秒更新日出後／日落前時段提示。
 *  3. 地圖載入可視範圍內的管制區（禁限航區依「限制區」欄位分紅區／黃區上色），移動後自動更新。
 *  4. 底部面板可拖拉（收合／半開／全開三段）；桌機固定在左側。
 *  5. 要塞堡壘地帶以示意圓圈＋三角形名稱顯示（data/fortress.json）。
 */
(function () {
  'use strict';

  // ---------- 圖層設定 ----------
  const CAA = 'https://dronegis.caa.gov.tw/server/rest/services/Hosted/';
  const F_AIR = ['空域名稱', '空域類別名稱', '空域說明', '主管機關名稱', '會商機關名稱', '聯絡方式', '罰則', '限制區'];
  const C = { red: '#C0392B', yellow: '#C9A227', purple: '#7B3FBF', blue: '#2848D0', green: '#6B9A2A', teal: '#149A8A' };
  // chip：屬於哪個圖層標籤（金馬地區併入「禁限航區」標籤開關）
  const LAYERS = [
    { key: 'uav', chip: 'uav', name: '禁限航區', color: C.red, path: 'UAV_fs/FeatureServer/3', fields: F_AIR },
    { key: 'temp', chip: 'temp', name: '臨時禁飛', color: C.purple, path: 'Temporary_Area/FeatureServer/19', fields: F_AIR },
    { key: 'port', chip: 'port', name: '商港', color: C.blue, path: 'Commercial_Port_fs/FeatureServer/4', fields: ['名稱', '所在地_應公告之地方政府_', '管理_及會商_機關', '管理_及會商_機關聯絡方式', '條件', '說明'] },
    { key: 'np', chip: 'np', name: '國家公園', color: C.green, path: 'National_Park_fs/FeatureServer/0', fields: ['name_full', '相關規'] },
    { key: 'km', chip: 'uav', name: '金馬地區', color: C.yellow, path: 'Kinmen_Matsu_Drone_Zone_fs/FeatureServer/0', fields: ['說明'] },
    { key: 'fort', chip: null, name: '要塞堡壘（示意）', color: C.teal },
  ];
  const byKey = Object.fromEntries(LAYERS.map((c) => [c.key, c]));
  const FORT_RADII = [600, 4000];   // 要塞第一區、第二區示意半徑（公尺）
  const MIN_DRAW_ZOOM = 7;          // 全臺視角（約 7）就開始畫管制區
  const TW_BOUNDS = [[21.85, 118.15], [26.4, 122.05]]; // 含澎湖、金門、馬祖的全臺範圍

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const richText = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');

  // ---------- 地圖與底圖 ----------
  const map = L.map('map', { zoomControl: false, preferCanvas: true, attributionControl: true });
  map.fitBounds(TW_BOUNDS);
  // 縮小時：Esri 地形圖（等高線、山影）；放大到街道級（12 以上）：國土測繪中心 臺灣通用電子地圖
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 11, attribution: '底圖：Esri',
  }).addTo(map);
  L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
    minZoom: 12, maxZoom: 19, attribution: '底圖：內政部國土測繪中心｜圖資：交通部民用航空局',
  }).addTo(map);
  const drawGroups = {};
  LAYERS.forEach((c) => { drawGroups[c.key] = L.layerGroup().addTo(map); });
  let marker = null;
  let fortItems = [];

  // ---------- JSONP：讀取民航局 ArcGIS 公開資料 ----------
  let jsonpSeq = 0;
  function jsonp(url, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
      const cb = `__fdeAs${Date.now()}_${jsonpSeq++}`;
      const s = document.createElement('script');
      const cleanup = () => { delete window[cb]; s.remove(); clearTimeout(timer); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('民航局服務逾時')); }, timeoutMs);
      window[cb] = (data) => { cleanup(); data && data.error ? reject(new Error(data.error.message || '民航局服務錯誤')) : resolve(data); };
      s.onerror = () => { cleanup(); reject(new Error('無法連線民航局服務')); };
      s.src = `${url}${url.includes('?') ? '&' : '?'}f=pjson&callback=${cb}`;
      document.head.appendChild(s);
    });
  }
  const queryUrl = (cfg, params, fields) => `${CAA}${cfg.path}/query?` + new URLSearchParams(Object.assign({ outFields: (fields || cfg.fields).join(','), outSR: '4326' }, params));

  // ---------- 台北時間工具 ----------
  const TPE = 'Asia/Taipei';
  // 取得台北當地的年月日
  function tpeYMD(ms) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: TPE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms).split('-');
    return [+p[0], +p[1], +p[2]];
  }
  const fmtHM = (ms) => new Intl.DateTimeFormat('zh-TW', { timeZone: TPE, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
  const fmtHMS = (ms) => new Intl.DateTimeFormat('zh-TW', { timeZone: TPE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(ms);
  const fmtFull = (ms) => { const [y, m, d] = tpeYMD(ms); return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')} ${fmtHMS(ms)}`; };
  const fmtDate = (ms) => { const [y, m, d] = tpeYMD(ms); return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`; };
  const dur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`; };

  /**
   * 日出／日落計算（常用天文近似公式，誤差約 1–2 分鐘）。
   * 輸入台北日期與經緯度，回傳該日日出、日落的時間戳（毫秒）。天頂角 90.833° 已含大氣折射與太陽半徑。
   */
  function sunTimes(y, m, d, lat, lon) {
    const rad = Math.PI / 180;
    const N = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000); // 一年中的第幾天
    const lngHour = lon / 15;
    function calc(rise) {
      const t = N + ((rise ? 6 : 18) - lngHour) / 24;
      const M = 0.9856 * t - 3.289;
      let Ls = (M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634) % 360;
      if (Ls < 0) Ls += 360;
      let RA = Math.atan(0.91764 * Math.tan(Ls * rad)) / rad;
      RA = (RA + 360) % 360;
      RA += Math.floor(Ls / 90) * 90 - Math.floor(RA / 90) * 90;   // 赤經放到與黃經同象限
      RA /= 15;
      const sinDec = 0.39782 * Math.sin(Ls * rad), cosDec = Math.cos(Math.asin(sinDec));
      const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
      if (cosH > 1 || cosH < -1) return null;                       // 極區無日出日落（臺灣不會發生）
      const H = (rise ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
      const T = H + RA - 0.06571 * t - 6.622;
      const local = (((T - lngHour) + 8) % 24 + 24) % 24;           // 換成台北時間（UTC+8）的小時數
      return Date.UTC(y, m - 1, d) + (local - 8) * 3600000;
    }
    return { rise: calc(true), set: calc(false) };
  }

  // ---------- 每個圖層的說明文字 ----------
  function describe(key, p) {
    if (key === 'uav' || key === 'temp') {
      return { title: p['空域名稱'] || '（未命名區域）', zone: p['限制區'], rows: [['類別', p['空域類別名稱']], ['限制', p['限制區']], ['主管機關', p['主管機關名稱']], ['會商機關', p['會商機關名稱']], ['說明', p['空域說明']], ['罰則', p['罰則']], ['聯絡方式', p['聯絡方式']]] };
    }
    if (key === 'np') return { title: p['name_full'] || '國家公園', rows: [['相關規定', p['相關規']]] };
    if (key === 'port') return { title: p['名稱'] || '商港', rows: [['所在地', p['所在地_應公告之地方政府_']], ['管理機關', p['管理_及會商_機關']], ['聯絡方式', p['管理_及會商_機關聯絡方式']], ['條件', p['條件']], ['說明', p['說明']]] };
    if (key === 'km') return { title: '金馬地區管制', rows: [['說明', p['說明']]] };
    return { title: '', rows: [] };
  }
  // 禁限航區單筆的顏色：限制區＝黃區 用黃色，其餘紅色
  const zoneColor = (key, attrs) => (key === 'uav' && attrs['限制區'] === '黃區') ? C.yellow : byKey[key].color;

  // 兩點距離（公尺，球面近似）
  function meters(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- 結果卡片 ----------
  const card = $('result');
  let current = null;   // 目前查詢點 { lat, lon, label, sun }
  const STATE_TEXT = {
    red: '此處位於紅區（禁止飛航區），不得飛航',
    yellow: '此處位於黃區（限制區），須經核准方得飛航',
    purple: '此處有臨時禁限航公告',
    blue: '此處位於商港範圍，須經管理機關同意',
    green: '查詢點未位於民航局公告之禁限航區',
  };
  function showMessage(state, text) {
    card.dataset.state = state;
    card.innerHTML = `<h2 class="as-result-title"><i class="as-dot"></i><span>${esc(text)}</span></h2>`;
  }

  // 日出日落提示框（每秒由時鐘重繪，跨過日出／日落自動切換）
  function sunBoxHtml(now) {
    if (!current || !current.sun.rise) return '';
    const { rise, set } = current.sun;
    if (now < rise) {
      return `<div class="as-sunbox as-sun-night"><strong>⛔ 目前為日出前時段，不得飛航</strong>今天日出時間 ${fmtHM(rise)}（距日出 ${dur(rise - now)}）<small>依《民用航空法》第 99 條之 14，遙控無人機不得於日落後至日出前飛航（經民航局許可者除外）；違者處新臺幣 3 萬元以上 15 萬元以下罰鍰。</small></div>`;
    }
    if (now >= set) {
      const [y, m, d] = tpeYMD(now + 86400000);
      const next = sunTimes(y, m, d, current.lat, current.lon).rise;
      return `<div class="as-sunbox as-sun-night"><strong>⛔ 目前為日落後時段，不得飛航</strong>明日日出時間 ${fmtHM(next)}（距日出 ${dur(next - now)}）<small>依《民用航空法》第 99 條之 14，遙控無人機不得於日落後至日出前飛航（經民航局許可者除外）；違者處新臺幣 3 萬元以上 15 萬元以下罰鍰。</small></div>`;
    }
    if (set - now <= 30 * 60000) {
      return `<div class="as-sunbox as-sun-dusk"><strong>⚠️ 即將日落</strong>今天日落時間 ${fmtHM(set)}（距日落 ${dur(set - now)}），日落後不得飛航</div>`;
    }
    // 日間：只說明時段；是否可飛仍取決於空域狀態
    if (current.state && current.state !== 'green') {
      const why = { red: '此處位於禁止飛航區（紅區），任何時段皆不得飛航。', yellow: '此處位於限制區（黃區），未經主管機關核准不得飛航。', purple: '此處有臨時禁飛公告，公告期間不得飛航。', blue: '此處位於商港範圍，須經港務管理機關同意方可飛航。' }[current.state];
      return `<div class="as-sunbox as-sun-dusk"><strong>☀️ 目前為日出後、日落前時段（今天日落時間 ${fmtHM(set)}）</strong>${why}</div>`;
    }
    return `<div class="as-sunbox as-sun-day"><strong>☀️ 目前為日出後、日落前時段</strong>今天日落時間 ${fmtHM(set)}（距日落 ${dur(set - now)}）。查詢點未位於民航局公告之禁限航區，飛航前仍應依《民用航空法》及《遙控無人機管理規則》確認註冊、操作證、目視範圍、距地面 400 呎以下等規定。</div>`;
  }
  function refreshSun() {
    const box = card.querySelector('[data-sunbox]');
    if (box) box.innerHTML = sunBoxHtml(Date.now());
  }

  // ---------- 點查：即時向民航局查該點所在的所有區域 ----------
  async function query(lat, lon, label) {
    if (marker) marker.remove();
    marker = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="as-here"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false }).addTo(map);
    const [y, m, d] = tpeYMD(Date.now());
    current = { lat, lon, label, sun: sunTimes(y, m, d, lat, lon) };
    openSheet('half');
    showMessage('idle', '向民航局查詢中…');

    const hits = [];
    let failed = false;
    const point = { geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false' };
    await Promise.all(LAYERS.filter((c) => c.path).map(async (cfg) => {
      try {
        const res = await jsonp(queryUrl(cfg, point));
        for (const f of res.features || []) {
          const a = f.attributes || {};
          hits.push({ cfg, color: zoneColor(cfg.key, a), d: describe(cfg.key, a) });
        }
      } catch (e) { failed = true; }
    }));
    if (!current || current.lat !== lat || current.lon !== lon) return; // 期間已改查別的點
    // 要塞：依距離判斷落在第一區或第二區示意範圍
    for (const ft of fortItems) {
      const dist = meters(lat, lon, ft.lat, ft.lon);
      if (dist <= FORT_RADII[1]) {
        const zone = dist <= FORT_RADII[0] ? '第一區（示意 600 公尺內）' : '第二區（示意 4 公里內）';
        hits.push({ cfg: byKey.fort, color: C.teal, d: { title: `${ft.name}要塞堡壘地帶`, rows: [['位置', `${ft.county}；距離約 ${(dist / 1000).toFixed(2)} 公里`], ['示意範圍', zone], ['國防部公告', ft.gazette], ['提醒', '示意位置非公告範圍，正確範圍以國防部公報為準。']] } });
      }
    }

    // 判斷卡片狀態：紅 > 黃 > 紫 > 藍 > 綠
    const has = (fn) => hits.some(fn);
    let state = 'green';
    if (has((h) => h.cfg.key === 'uav' && h.d.zone !== '黃區')) state = 'red';
    else if (has((h) => (h.cfg.key === 'uav' && h.d.zone === '黃區') || h.cfg.key === 'km' || h.cfg.key === 'fort')) state = 'yellow';
    else if (has((h) => h.cfg.key === 'temp')) state = 'purple';
    else if (has((h) => h.cfg.key === 'port')) state = 'blue';

    const order = ['uav', 'temp', 'km', 'port', 'fort', 'np'];
    hits.sort((a, b) => order.indexOf(a.cfg.key) - order.indexOf(b.cfg.key));
    const inPark = has((h) => h.cfg.key === 'np');
    let extra = '';
    if (failed) extra += '<p class="as-msg" style="color:#a3401c">⚠️ 部分民航局圖層查詢失敗，結果可能不完整，請以官方查詢為準。</p>';
    if (state === 'green') extra += `<p class="as-msg">${inPark ? '⚠️ 此處位於國家公園範圍，空拍須事先向國家公園管理處申請。' : '國家公園範圍內空拍須事先向管理處申請。'}</p>`;
    const list = hits.map(({ cfg, color, d }) => `
      <li style="border-left-color:${color}"><details><summary><span class="as-tag" style="background:${color}">${esc(cfg.key === 'uav' ? (d.zone || '禁限航區') : cfg.name)}</span>${esc(d.title)}</summary>
      <dl>${d.rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${richText(v)}</dd>`).join('')}</dl></details></li>`).join('');

    current.state = state;   // 供日出日落提示判斷用語
    card.dataset.state = state;
    card.innerHTML = `
      <h2 class="as-result-title"><i class="as-dot"></i><span>${STATE_TEXT[state]}</span></h2>
      <p class="as-coord">${esc(label || '地圖選取位置')} · <span>${lat.toFixed(5)}, ${lon.toFixed(5)}</span></p>
      <p class="as-sun">🌅 日出 <b>${current.sun.rise ? fmtHM(current.sun.rise) : '—'}</b>　🌇 日落 <b>${current.sun.set ? fmtHM(current.sun.set) : '—'}</b></p>
      <div data-sunbox>${sunBoxHtml(Date.now())}</div>
      ${extra}
      ${list ? `<ul class="as-hits">${list}</ul>` : ''}
      <p class="as-msg" style="color:var(--muted);font-size:12.5px">本查詢結果僅供參考，不代表飛航許可；實際飛航應以交通部民用航空局「遙控無人機管理資訊系統」查詢結果及公告為準。</p>`;
  }

  // ---------- 在地圖上畫出目前可視範圍內的管制區 ----------
  const ringsToLatLngs = (rings) => rings.map((ring) => ring.map(([x, yy]) => [yy, x]));
  let drawSeq = 0;
  async function drawVisible() {
    const z = map.getZoom();
    if (z < MIN_DRAW_ZOOM) {
      LAYERS.forEach((c) => c.path && drawGroups[c.key].clearLayers());
      setStatus('放大地圖即可顯示民航局管制區');
      return;
    }
    const seq = ++drawSeq;
    const b = map.getBounds();
    // 依縮放程度簡化幾何（度；約 1 公尺 ≈ 0.00001 度）
    const offset = z >= 15 ? 0.00002 : z >= 13 ? 0.0001 : z >= 11 ? 0.0004 : z >= 9 ? 0.0015 : 0.004;
    const env = { geometry: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', maxAllowableOffset: String(offset), geometryPrecision: z >= 11 ? '6' : '4', resultRecordCount: '2000', orderByFields: 'objectid' };
    setStatus('載入民航局管制區…');
    let total = 0, failed = 0;
    await Promise.all(LAYERS.filter((c) => c.path).map(async (cfg) => {
      const fields = cfg.key === 'uav' || cfg.key === 'temp' ? ['空域名稱', '限制區'] : cfg.fields.slice(0, 1);
      const feats = [];
      try {
        // 分頁讀取（伺服器每次最多 2000 筆）
        for (let off = 0; off < 8000; off += 2000) {
          const res = await jsonp(queryUrl(cfg, Object.assign({ resultOffset: String(off) }, env), fields));
          if (seq !== drawSeq) return;            // 使用者已移動地圖，丟掉舊結果
          feats.push(...(res.features || []));
          if (!res.exceededTransferLimit) break;
        }
      } catch (e) { failed++; return; }
      drawGroups[cfg.key].clearLayers();
      for (const f of feats) {
        if (!f.geometry || !f.geometry.rings) continue;
        const a = f.attributes || {};
        const color = zoneColor(cfg.key, a);
        const isPark = cfg.key === 'np';
        const poly = L.polygon(ringsToLatLngs(f.geometry.rings), { color, weight: isPark ? 2.5 : 1.2, fillColor: color, fillOpacity: isPark ? 0 : 0.28 });
        // 點紅／黃／紫區：彈出區域名稱（同時照常查詢該點）
        const name = Object.values(a).filter((v) => typeof v === 'string' && v).join('｜') || cfg.name;
        poly.bindPopup(esc(name));
        poly.addTo(drawGroups[cfg.key]);
        total++;
      }
    }));
    if (seq !== drawSeq) return;
    setStatus(failed ? `部分民航局圖層載入失敗（${failed} 層），點地圖仍可查詢` : `此範圍共 ${total.toLocaleString()} 個管制區・點地圖任一處可查詢`, failed > 0);
  }

  function setStatus(msg, warn = false) {
    const s = $('status');
    s.textContent = msg;
    s.classList.toggle('as-status-warn', warn);
  }

  // ---------- 圖層標籤開關 ----------
  for (const chip of document.querySelectorAll('.as-chip')) {
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      for (const cfg of LAYERS.filter((c) => c.chip === chip.dataset.layer)) {
        if (on) drawGroups[cfg.key].addTo(map); else drawGroups[cfg.key].remove();
      }
    });
  }

  // ---------- 民航局資料統計（數字與更新時間全部即時取得，不寫死） ----------
  async function loadStats() {
    const checked = Date.now();
    const names = { uav: '禁限航區', temp: '臨時', port: '商港', np: '國家公園' };
    const parts = [];
    let lastEdit = 0;
    await Promise.all(Object.keys(names).map(async (k) => {
      try {
        const cnt = await jsonp(`${CAA}${byKey[k].path}/query?where=1%3D1&returnCountOnly=true`);
        names[k] = `${names[k]} ${Number(cnt.count).toLocaleString()}${k === 'uav' ? ' 區' : ''}`;
        const info = await jsonp(`${CAA}${byKey[k].path}?x=1`);   // 圖層資訊：取最後編修時間
        const t = (info.editingInfo && (info.editingInfo.dataLastEditDate || info.editingInfo.lastEditDate)) || 0;
        if (t > lastEdit) lastEdit = t;
      } catch (e) { names[k] += ' ?'; }
    }));
    ['uav', 'temp', 'port', 'np'].forEach((k) => parts.push(names[k]));
    $('checkText').textContent = `即時連線民航局・最後檢查 ${fmtFull(checked).slice(0, 16)}`;
    $('dataRow').textContent = `民航局圖資更新：${lastEdit ? fmtDate(lastEdit) : '（民航局未提供）'}（最後檢查 ${fmtFull(checked)}） · ${parts.join(' · ')}`;
  }

  // ---------- 要塞示意資料：圓圈＋黑色三角形名稱 ----------
  async function loadForts() {
    try {
      const fort = await fetch('./data/fortress.json', { cache: 'no-cache' }).then((r) => r.json());
      fortItems = fort.items.filter((x) => x.lat != null);
      for (const ft of fortItems) {
        L.circle([ft.lat, ft.lon], { radius: FORT_RADII[1], color: C.teal, weight: 1, dashArray: '4 4', fillOpacity: 0.04, interactive: false }).addTo(drawGroups.fort);
        L.circle([ft.lat, ft.lon], { radius: FORT_RADII[0], color: C.teal, weight: 1, fillOpacity: 0.25, interactive: false }).addTo(drawGroups.fort);
        L.marker([ft.lat, ft.lon], { icon: L.divIcon({ className: '', html: `<span class="as-peak">${esc(ft.name)}</span>`, iconSize: null, iconAnchor: [8, 10] }), interactive: false }).addTo(drawGroups.fort);
      }
    } catch (e) { /* 要塞資料缺少時不影響民航局查詢 */ }
  }

  // ---------- 底部面板：收合／半開／全開，可拖拉 ----------
  const sheet = $('sheet'), toggleBtn = $('toggleBtn');
  const isDesktop = () => window.innerWidth >= 900;
  let sheetState = 'half';
  // 各段面板「露出高度」換算成位移量（面板本身高 88dvh）
  function sheetY(state) {
    const H = sheet.offsetHeight, vh = window.innerHeight;
    const show = state === 'full' ? H : state === 'half' ? vh * 0.42 : 150;
    return Math.max(0, H - show);
  }
  function openSheet(state) {
    if (isDesktop()) return;
    sheetState = state;
    sheet.dataset.state = state;   // 讓樣式知道目前段落（全開時隱藏定位鈕）
    sheet.style.setProperty('--sheet-y', `${sheetY(state)}px`);
    toggleBtn.textContent = state === 'full' ? '▼ 看地圖' : '▲ 看結果';
  }
  toggleBtn.addEventListener('click', () => openSheet(sheetState === 'full' ? 'peek' : 'full'));
  // 拖拉：從把手或面板頂端開始拖，放開後吸附到最近的一段
  let drag = null;
  sheet.addEventListener('pointerdown', (e) => {
    if (isDesktop() || e.target.closest('.as-sheet-body, button')) return;
    drag = { y0: e.clientY, base: sheetY(sheetState) };
    sheet.classList.add('as-dragging');
    sheet.setPointerCapture(e.pointerId);
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const y = Math.min(sheet.offsetHeight - 110, Math.max(0, drag.base + e.clientY - drag.y0));
    drag.cur = y;
    sheet.style.setProperty('--sheet-y', `${y}px`);
  });
  const endDrag = () => {
    if (!drag) return;
    sheet.classList.remove('as-dragging');
    const y = drag.cur ?? drag.base;
    drag = null;
    const best = ['full', 'half', 'peek'].map((s) => [s, Math.abs(sheetY(s) - y)]).sort((a, b) => a[1] - b[1])[0][0];
    openSheet(best);
  };
  sheet.addEventListener('pointerup', endDrag);
  sheet.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => openSheet(sheetState));

  // ---------- 互動：點地圖、移動地圖、搜尋、定位 ----------
  map.on('click', (e) => query(e.latlng.lat, e.latlng.lng, null));
  let moveTimer = 0;
  map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(drawVisible, 350); });

  // 搜尋：「緯度,經度」直接定位；否則用 OpenStreetMap Nominatim 找臺灣地名，取第一筆
  $('searchForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = $('searchInput').value.trim();
    if (!q) return;
    $('searchInput').blur();
    const mm = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (mm) {
      let lat = +mm[1], lon = +mm[2];
      if (Math.abs(lat) > 90) [lat, lon] = [lon, lat];   // 使用者把經度寫在前面時自動對調
      map.setView([lat, lon], 15);
      query(lat, lon, `座標 ${lat}, ${lon}`);
      return;
    }
    openSheet('half');
    showMessage('idle', '搜尋地點中…');
    try {
      const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'json', limit: '1', countrycodes: 'tw', 'accept-language': 'zh-TW' });
      const list = await fetch(url).then((r) => r.json());
      if (!list.length) { current = null; showMessage('idle', '找不到這個地點，請換個關鍵字或輸入座標'); return; }
      const lat = +list[0].lat, lon = +list[0].lon;
      map.setView([lat, lon], 15);
      query(lat, lon, q);
    } catch (e) {
      showMessage('idle', '搜尋服務暫時無法使用，請改輸入座標（例如 24.1789, 120.6045）');
    }
  });

  // 目前位置
  $('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { showMessage('idle', '此瀏覽器不支援定位'); openSheet('half'); return; }
    setStatus('定位中…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { const { latitude: lat, longitude: lon } = pos.coords; map.setView([lat, lon], 15); query(lat, lon, '我目前的位置'); },
      () => { current = null; openSheet('half'); showMessage('idle', '請允許定位權限'); setStatus('無法取得位置', true); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });

  // ---------- 即時時鐘：每秒更新台北時間，並重繪日出日落提示 ----------
  function tick() {
    $('clock').textContent = fmtHMS(Date.now());
    refreshSun();
  }
  setInterval(tick, 1000);
  tick();

  // 給自動化測試使用的掛鉤（只能查詢，不會改資料）
  window.__fdeAirspace = { map, query, drawVisible, sunTimes, openSheet };

  // ---------- 啟動 ----------
  openSheet('half');
  (async () => {
    await loadForts();
    drawVisible();
    loadStats();
  })();
})();
