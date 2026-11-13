/**
 * FDE 空域查詢主程式（自行撰寫）。
 * 資料：交通部民用航空局 遙控無人機管理資訊系統 公開圖層（dronegis.caa.gov.tw，ArcGIS 伺服器）。
 *   - 民航局伺服器不接受其他網站的一般跨站請求，但它本身提供 JSONP（標準的公開資料跨站讀取方式，
 *     由伺服器回傳 callback(...)），因此本頁以 JSONP 讓訪客瀏覽器「即時」向民航局查詢，資料永遠最新。
 * 功能：
 *  1. 點地圖／搜尋地名／定位 → 即時查詢該點落在哪些管制區（禁限航區、臨時空域、國家公園、商港、金馬）。
 *  2. 地圖放大到縣市層級以上時，載入「目前可視範圍」內的管制區並依縮放程度簡化，移動後自動更新。
 *  3. 要塞堡壘地帶以示意圓圈顯示（data/fortress.json），點查時依距離判斷第一區／第二區。
 */
(function () {
  'use strict';

  // ---------- 圖層設定：鍵、中文名稱、顏色、民航局服務路徑、要取的欄位 ----------
  const CAA = 'https://dronegis.caa.gov.tw/server/rest/services/Hosted/';
  const F_AIR = ['空域名稱', '空域類別名稱', '空域說明', '主管機關名稱', '會商機關名稱', '聯絡方式', '罰則', '限制區'];
  const LAYERS = [
    { key: 'uav', name: '禁限航區', color: '#e5383b', path: 'UAV_fs/FeatureServer/3', fields: F_AIR },
    { key: 'temp', name: '臨時空域', color: '#f77f00', path: 'Temporary_Area/FeatureServer/19', fields: F_AIR },
    { key: 'np', name: '國家公園', color: '#2b9348', path: 'National_Park_fs/FeatureServer/0', fields: ['name_full', '相關規'] },
    { key: 'port', name: '商港', color: '#3a86ff', path: 'Commercial_Port_fs/FeatureServer/4', fields: ['名稱', '所在地_應公告之地方政府_', '管理_及會商_機關', '管理_及會商_機關聯絡方式', '條件', '說明', '有效日期起', '有效日期迄'] },
    { key: 'km', name: '金馬地區', color: '#8338ec', path: 'Kinmen_Matsu_Drone_Zone_fs/FeatureServer/0', fields: ['說明'] },
    { key: 'fort', name: '要塞堡壘（示意）', color: '#ff4fa3' },
  ];
  const FORT_RADII = [600, 4000];   // 要塞第一區、第二區示意半徑（公尺）
  const MIN_DRAW_ZOOM = 10;         // 放大到這個層級以上才在地圖上畫管制區（避免一次載入 5,000 多筆）

  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enabled = {};               // 各圖層是否開啟
  LAYERS.forEach((c) => { enabled[c.key] = true; });

  // ---------- 地圖與底圖 ----------
  const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([23.7, 120.95], 8);
  // 國土測繪中心 臺灣通用電子地圖（WMTS，Google 相容切片）
  L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
    maxZoom: 19, attribution: '底圖：內政部國土測繪中心 臺灣通用電子地圖｜圖資：交通部民用航空局',
  }).addTo(map);
  const drawGroups = {};            // 各圖層目前畫在地圖上的群組
  LAYERS.forEach((c) => { drawGroups[c.key] = L.layerGroup().addTo(map); });
  let marker = null;
  let fortItems = [];

  // ---------- JSONP：讀取民航局 ArcGIS 公開資料 ----------
  let jsonpSeq = 0;
  function jsonp(url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const cb = `__fdeAs${Date.now()}_${jsonpSeq++}`;
      const s = document.createElement('script');
      const cleanup = () => { delete window[cb]; s.remove(); clearTimeout(timer); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('民航局服務逾時')); }, timeoutMs);
      window[cb] = (data) => { cleanup(); data && data.error ? reject(new Error(data.error.message || '民航局服務錯誤')) : resolve(data); };
      s.onerror = () => { cleanup(); reject(new Error('無法連線民航局服務')); };
      s.src = `${url}&f=pjson&callback=${cb}`;
      document.head.appendChild(s);
    });
  }
  function queryUrl(cfg, params) {
    return `${CAA}${cfg.path}/query?` + new URLSearchParams(Object.assign({ outFields: cfg.fields.join(','), outSR: '4326' }, params));
  }

  // ---------- 每個圖層要顯示的文字 ----------
  function describe(key, p) {
    if (key === 'uav' || key === 'temp') {
      return { title: p['空域名稱'] || '（未命名區域）', rows: [['類別', p['空域類別名稱']], ['主管機關', p['主管機關名稱']], ['會商機關', p['會商機關名稱']], ['說明', p['空域說明']], ['限制', p['限制區']], ['罰則', p['罰則']], ['聯絡方式', p['聯絡方式']]] };
    }
    if (key === 'np') return { title: p['name_full'] || '國家公園', rows: [['相關規定', p['相關規']]] };
    if (key === 'port') return { title: p['名稱'] || '商港', rows: [['所在地', p['所在地_應公告之地方政府_']], ['管理機關', p['管理_及會商_機關']], ['聯絡方式', p['管理_及會商_機關聯絡方式']], ['條件', p['條件']], ['說明', p['說明']]] };
    if (key === 'km') return { title: '金馬地區管制', rows: [['說明', p['說明']]] };
    return { title: '', rows: [] };
  }
  // 純文字轉 HTML（保留換行、網址變連結）
  const richText = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');

  // 兩點距離（公尺，球面近似）
  function meters(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- 點查：即時向民航局查該點所在的所有區域 ----------
  async function query(lat, lon, label) {
    if (marker) marker.remove();
    marker = L.marker([lat, lon]).addTo(map);
    const where = label ? `<p class="as-where">📍 ${esc(label)}</p>` : '';
    const coord = `<p class="as-muted as-small">座標 ${lat.toFixed(5)}, ${lon.toFixed(5)}</p>`;
    $('result').innerHTML = `${where}${coord}<p class="as-muted">向民航局查詢中…</p>`;
    $('resultHint').hidden = true;

    const hits = [];
    let failed = false;
    const point = { geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'false' };
    await Promise.all(LAYERS.filter((c) => c.path).map(async (cfg) => {
      try {
        const d = await jsonp(queryUrl(cfg, point));
        for (const f of d.features || []) hits.push({ cfg, d: describe(cfg.key, f.attributes || {}) });
      } catch (e) { failed = true; }
    }));
    // 要塞：依距離判斷落在第一區或第二區示意範圍
    for (const ft of fortItems) {
      const dist = meters(lat, lon, ft.lat, ft.lon);
      if (dist <= FORT_RADII[1]) {
        const zone = dist <= FORT_RADII[0] ? '第一區（示意 600 公尺內）' : '第二區（示意 4 公里內）';
        hits.push({ cfg: LAYERS[5], d: { title: `${ft.name}要塞堡壘地帶`, rows: [['位置', `${ft.county}；距離約 ${(dist / 1000).toFixed(2)} 公里`], ['示意範圍', zone], ['國防部公告', ft.gazette], ['提醒', '示意位置非公告範圍，正確範圍以國防部公報為準。']] } });
      }
    }
    // 依類別排序：禁限航區、臨時空域優先
    const order = LAYERS.map((c) => c.key);
    hits.sort((a, b) => order.indexOf(a.cfg.key) - order.indexOf(b.cfg.key));

    let html = `${where}${coord}`;
    if (failed) html += '<p class="as-warn">⚠️ 部分民航局圖層查詢失敗，結果可能不完整，請以官方查詢為準。</p>';
    if (!hits.length && !failed) {
      html += '<p class="as-ok">✅ 民航局公開圖層顯示此點不在禁限航區、臨時空域、國家公園或商港範圍內。</p><p class="as-muted">仍須遵守一般規定（日間、視距內、高度 400 呎以下等），起飛前請以民航局官方查詢確認。</p>';
    } else if (hits.length) {
      html += `<p class="as-warn">⚠️ 此點位於 ${hits.length} 個管制相關區域：</p>` + hits.map(({ cfg, d }) => `
        <article class="as-hit" style="border-left-color:${cfg.color}">
          <span class="as-tag" style="background:${cfg.color}">${esc(cfg.name)}</span>
          <h3>${esc(d.title)}</h3>
          <dl>${d.rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${richText(v)}</dd>`).join('')}</dl>
        </article>`).join('');
    }
    $('result').innerHTML = html;
    if (window.innerWidth < 900) $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- 在地圖上畫出目前可視範圍內的管制區 ----------
  // Esri JSON 的 rings（外環＋洞）→ Leaflet 多邊形座標（[緯度, 經度]）
  const ringsToLatLngs = (rings) => rings.map((ring) => ring.map(([x, y]) => [y, x]));
  let drawSeq = 0;
  async function drawVisible() {
    const z = map.getZoom();
    if (z < MIN_DRAW_ZOOM) {
      LAYERS.forEach((c) => c.path && drawGroups[c.key].clearLayers());
      setStatus(`放大地圖（至縣市以上層級）即可顯示民航局管制區；點任一處可直接查詢`);
      return;
    }
    const seq = ++drawSeq;
    const b = map.getBounds();
    // 依縮放程度簡化幾何：越放大越精細（度；約 1 公尺 ≈ 0.00001 度）
    const offset = z >= 15 ? 0.00002 : z >= 13 ? 0.0001 : z >= 11 ? 0.0004 : 0.001;
    const env = { geometry: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', maxAllowableOffset: String(offset), geometryPrecision: '6', resultRecordCount: '2000' };
    setStatus('載入民航局管制區…');
    let total = 0, failed = 0;
    await Promise.all(LAYERS.filter((c) => c.path).map(async (cfg) => {
      try {
        const d = await jsonp(queryUrl(Object.assign({}, cfg, { fields: cfg.key === 'uav' || cfg.key === 'temp' ? ['空域名稱', '空域類別名稱'] : cfg.fields.slice(0, 1) }), env));
        if (seq !== drawSeq) return;             // 使用者已經移動地圖，丟掉舊結果
        drawGroups[cfg.key].clearLayers();
        for (const f of d.features || []) {
          if (!f.geometry || !f.geometry.rings) continue;
          const name = Object.values(f.attributes || {}).filter(Boolean).join('｜');
          L.polygon(ringsToLatLngs(f.geometry.rings), { color: cfg.color, weight: 1, fillColor: cfg.color, fillOpacity: cfg.key === 'np' ? 0.12 : 0.22, interactive: false, title: name }).addTo(drawGroups[cfg.key]);
          total++;
        }
      } catch (e) { failed++; }
    }));
    if (seq !== drawSeq) return;
    setStatus(failed ? `部分民航局圖層載入失敗（${failed} 層），點地圖仍可查詢` : `此範圍內共 ${total} 個管制區；點任一處查詢詳細內容`, failed > 0);
  }

  function setStatus(msg, warn = false) {
    status.hidden = false;
    status.textContent = msg;
    status.classList.toggle('as-status-warn', warn);
  }

  // ---------- 圖層開關 ----------
  function buildToggles() {
    const box = $('layerToggles');
    for (const cfg of LAYERS) {
      const label = document.createElement('label');
      const count = cfg.key === 'fort' ? `${fortItems.length} 處` : '即時查詢';
      label.innerHTML = `<input type="checkbox" checked><i style="background:${cfg.color}"></i>${esc(cfg.name)} <small>${count}</small>`;
      box.appendChild(label);
      label.querySelector('input').addEventListener('change', (ev) => {
        enabled[cfg.key] = ev.target.checked;
        if (ev.target.checked) drawGroups[cfg.key].addTo(map); else drawGroups[cfg.key].remove();
      });
    }
    $('dataDate').textContent = '民航局圖層為即時查詢（每次查詢都向民航局取得最新資料）';
  }

  // ---------- 要塞示意資料 ----------
  async function loadForts() {
    try {
      const fort = await fetch('./data/fortress.json', { cache: 'no-cache' }).then((r) => r.json());
      fortItems = fort.items.filter((x) => x.lat != null);
      for (const ft of fortItems) {
        L.circle([ft.lat, ft.lon], { radius: FORT_RADII[1], color: '#ff4fa3', weight: 1, dashArray: '4 4', fillOpacity: 0.05, interactive: false }).addTo(drawGroups.fort);
        L.circle([ft.lat, ft.lon], { radius: FORT_RADII[0], color: '#ff4fa3', weight: 1, fillOpacity: 0.25, interactive: false }).addTo(drawGroups.fort);
      }
    } catch (e) { /* 要塞資料缺少時不影響民航局查詢 */ }
  }

  // ---------- 互動：點地圖、移動地圖、搜尋、定位 ----------
  map.on('click', (e) => query(e.latlng.lat, e.latlng.lng, null));
  let moveTimer = 0;
  map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(drawVisible, 350); });

  // 地名搜尋（OpenStreetMap Nominatim；限定臺灣，最多 5 筆）
  const suggest = $('suggest');
  $('searchForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const q = $('searchInput').value.trim();
    if (!q) return;
    suggest.hidden = false;
    suggest.innerHTML = '<li class="as-muted">搜尋中…</li>';
    try {
      const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'json', limit: '5', countrycodes: 'tw', 'accept-language': 'zh-TW' });
      const list = await fetch(url).then((r) => r.json());
      if (!list.length) { suggest.innerHTML = '<li class="as-muted">找不到這個地點，換個關鍵字試試</li>'; return; }
      suggest.innerHTML = '';
      for (const it of list) {
        const li = document.createElement('li');
        li.textContent = it.display_name;
        li.tabIndex = 0;
        const go = () => {
          const lat = +it.lat, lon = +it.lon;
          map.setView([lat, lon], 14);
          query(lat, lon, it.display_name.split(',').slice(0, 3).join('，'));
          suggest.hidden = true;
        };
        li.addEventListener('click', go);
        li.addEventListener('keydown', (k) => { if (k.key === 'Enter') go(); });
        suggest.appendChild(li);
      }
    } catch (e) {
      suggest.innerHTML = '<li class="as-muted">搜尋服務暫時無法使用</li>';
    }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.as-search, .as-suggest')) suggest.hidden = true; });

  // 目前位置
  $('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { setStatus('此瀏覽器不支援定位', true); return; }
    setStatus('定位中…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { const { latitude: lat, longitude: lon } = pos.coords; map.setView([lat, lon], 14); query(lat, lon, '我目前的位置'); },
      () => setStatus('無法取得位置（請允許定位權限）', true),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });

  // 給自動化測試使用的掛鉤（只能查詢，不會改資料）
  window.__fdeAirspace = { map, query, drawVisible };

  // ---------- 啟動 ----------
  (async () => {
    await loadForts();
    buildToggles();
    drawVisible();
  })();
})();
