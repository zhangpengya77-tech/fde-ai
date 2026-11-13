/**
 * FDE 空域查詢主程式（自行撰寫）。
 * 功能：
 *  1. 載入政府公開圖層（data/caa-airspace.json）與要塞示意資料（data/fortress.json），畫在 Leaflet 地圖上。
 *  2. 點地圖／搜尋地名／定位目前位置 → 判斷該點落在哪些管制區，列出主管機關、說明、聯絡方式。
 *  3. 圖層可開關；資料不存在時顯示提示，不讓頁面壞掉。
 */
(function () {
  'use strict';

  // ---------- 圖層設定：鍵、中文名稱、顏色、說明欄位 ----------
  const LAYERS = [
    { key: 'uav', name: '禁限航區', color: '#e5383b', on: true },
    { key: 'temp', name: '臨時空域', color: '#f77f00', on: true },
    { key: 'np', name: '國家公園', color: '#2b9348', on: true },
    { key: 'port', name: '商港', color: '#3a86ff', on: true },
    { key: 'km', name: '金馬地區', color: '#8338ec', on: true },
    { key: 'fort', name: '要塞堡壘（示意）', color: '#ff4fa3', on: true },
  ];
  const FORT_RADII = [600, 4000]; // 要塞第一區、第二區示意半徑（公尺）

  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 地圖與底圖 ----------
  const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([23.7, 120.95], 8);
  // 國土測繪中心 臺灣通用電子地圖（WMTS，Google 相容切片）
  L.tileLayer('https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}', {
    maxZoom: 19, attribution: '底圖：內政部國土測繪中心 臺灣通用電子地圖',
  }).addTo(map);

  const groups = {};      // 每個圖層的 Leaflet 群組
  const features = {};    // 每個圖層的原始 GeoJSON 要素（點查用）
  let marker = null;      // 查詢點標記

  // ---------- 點在多邊形內判斷（射線法；支援 Polygon／MultiPolygon，含內環洞） ----------
  function inRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inPolygon(lon, lat, rings) {
    if (!rings.length || !inRing(lon, lat, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) if (inRing(lon, lat, rings[k])) return false; // 落在洞裡
    return true;
  }
  function contains(geom, lon, lat) {
    if (!geom) return false;
    if (geom.type === 'Polygon') return inPolygon(lon, lat, geom.coordinates);
    if (geom.type === 'MultiPolygon') return geom.coordinates.some((p) => inPolygon(lon, lat, p));
    return false;
  }
  // 預先算外框，加速點查（先比外框，再做精確判斷）
  function bbox(geom) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const walk = (x) => { if (typeof x[0] === 'number') { a = Math.min(a, x[0]); b = Math.min(b, x[1]); c = Math.max(c, x[0]); d = Math.max(d, x[1]); } else x.forEach(walk); };
    walk(geom.coordinates);
    return [a, b, c, d];
  }
  // 兩點距離（公尺，球面近似）
  function meters(lat1, lon1, lat2, lon2) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------- 每個圖層要顯示的文字 ----------
  function describe(key, p) {
    if (key === 'uav' || key === 'temp') {
      return { title: p['空域名稱'] || '（未命名區域）', rows: [['類別', p['空域類別名稱']], ['主管機關', p['主管機關名稱']], ['會商機關', p['會商機關名稱']], ['說明', p['空域說明']], ['限制', p['限制區']], ['罰則', p['罰則']], ['聯絡方式', p['聯絡方式']]] };
    }
    if (key === 'np') return { title: p['name_full'] || '國家公園', rows: [['相關規定', p['相關規']]] };
    if (key === 'port') return { title: p['名稱'] || '商港', rows: [['所在地', p['所在地_應公告之地方政府_']], ['管理機關', p['管理_及會商_機關']], ['聯絡方式', p['管理_及會商_機關聯絡方式']], ['條件', p['條件']], ['說明', p['說明']], ['有效期間', [p['有效日期起'], p['有效日期迄']].filter(Boolean).join(' ～ ')]] };
    if (key === 'km') return { title: '金馬地區管制', rows: [['說明', p['說明']]] };
    return { title: '', rows: [] };
  }
  // 純文字轉 HTML（保留換行、網址變連結）
  function richText(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  }

  // ---------- 點查：列出該點所在的所有區域 ----------
  function query(lat, lon, label) {
    if (marker) marker.remove();
    marker = L.marker([lat, lon]).addTo(map);
    const hits = [];
    for (const cfg of LAYERS) {
      if (cfg.key === 'fort') continue;
      for (const f of features[cfg.key] || []) {
        const bb = f._bb;
        if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
        if (contains(f.geometry, lon, lat)) hits.push({ cfg, d: describe(cfg.key, f.properties || {}) });
      }
    }
    // 要塞：依距離判斷落在第一區或第二區示意範圍
    for (const ft of features.fort || []) {
      const dist = meters(lat, lon, ft.lat, ft.lon);
      if (dist <= FORT_RADII[1]) {
        const zone = dist <= FORT_RADII[0] ? '第一區（示意 600 公尺內）' : '第二區（示意 4 公里內）';
        hits.push({ cfg: LAYERS[5], d: { title: `${ft.name}要塞堡壘地帶`, rows: [['位置', `${ft.county}；距離約 ${(dist / 1000).toFixed(2)} 公里`], ['示意範圍', zone], ['國防部公告', ft.gazette], ['提醒', '示意位置非公告範圍，正確範圍以國防部公報為準。']] } });
      }
    }
    const where = label ? `<p class="as-where">📍 ${esc(label)}</p>` : '';
    const coord = `<p class="as-muted as-small">座標 ${lat.toFixed(5)}, ${lon.toFixed(5)}</p>`;
    // 民航局禁限航區沒載入時，不能說「不在管制區」，避免誤導
    const caaMissing = !(features.uav && features.uav.length);
    if (!hits.length && caaMissing) {
      $('result').innerHTML = `${where}${coord}<p class="as-warn">⚠️ 民航局禁限航區資料尚未載入，無法判斷此點是否可飛。</p><p class="as-muted">請改用<a href="https://drone.caa.gov.tw/" target="_blank" rel="noopener">民航局官方空域查詢</a>。</p>`;
    } else if (!hits.length) {
      $('result').innerHTML = `${where}${coord}<p class="as-ok">✅ 此點不在本頁收錄的管制區域內。</p><p class="as-muted">仍須遵守一般規定（日間、視距內、高度 400 呎以下等），並以民航局官方查詢確認。</p>`;
    } else {
      $('result').innerHTML = `${where}${coord}<p class="as-warn">⚠️ 此點位於 ${hits.length} 個管制相關區域：</p>` + hits.map(({ cfg, d }) => `
        <article class="as-hit" style="border-left-color:${cfg.color}">
          <span class="as-tag" style="background:${cfg.color}">${esc(cfg.name)}</span>
          <h3>${esc(d.title)}</h3>
          <dl>${d.rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${richText(v)}</dd>`).join('')}</dl>
        </article>`).join('');
    }
    $('resultHint').hidden = true;
    // 手機：捲到結果
    if (window.innerWidth < 900) $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- 載入資料 ----------
  async function loadJson(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${url} HTTP ${r.status}`);
    return r.json();
  }

  async function init() {
    const missing = [];
    // 政府公開圖層
    try {
      const caa = await loadJson('./data/caa-airspace.json');
      for (const cfg of LAYERS) {
        const fc = caa.layers && caa.layers[cfg.key];
        if (!fc) continue;
        features[cfg.key] = fc.features.filter((f) => f.geometry).map((f) => Object.assign(f, { _bb: bbox(f.geometry) }));
        groups[cfg.key] = L.geoJSON(fc, {
          style: { color: cfg.color, weight: 1, fillColor: cfg.color, fillOpacity: cfg.key === 'np' ? 0.12 : 0.22 },
          interactive: false, // 點擊交給地圖統一處理（避免多層重疊時只抓到最上層）
        });
      }
      const t = caa['下載時間'] ? new Date(caa['下載時間']) : null;
      $('dataDate').textContent = t ? `政府圖層資料日期：${t.toLocaleDateString('zh-TW')}（${caa['簡化'] || ''}）` : '';
    } catch (e) {
      missing.push('禁限航區等民航局圖層');
      console.warn('民航局圖層未載入：', e);
    }
    // 要塞堡壘示意
    try {
      const fort = await loadJson('./data/fortress.json');
      features.fort = fort.items.filter((x) => x.lat != null);
      const g = L.layerGroup();
      for (const ft of features.fort) {
        L.circle([ft.lat, ft.lon], { radius: FORT_RADII[1], color: '#ff4fa3', weight: 1, dashArray: '4 4', fillOpacity: 0.05, interactive: false }).addTo(g);
        L.circle([ft.lat, ft.lon], { radius: FORT_RADII[0], color: '#ff4fa3', weight: 1, fillOpacity: 0.25, interactive: false }).addTo(g);
      }
      groups.fort = g;
    } catch (e) {
      missing.push('要塞示意資料');
    }

    // 圖層開關
    const box = $('layerToggles');
    for (const cfg of LAYERS) {
      const count = cfg.key === 'fort' ? (features.fort || []).length : (features[cfg.key] || []).length;
      const id = `lyr-${cfg.key}`;
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" id="${id}" ${cfg.on && groups[cfg.key] ? 'checked' : ''} ${groups[cfg.key] ? '' : 'disabled'}>
        <i style="background:${cfg.color}"></i>${esc(cfg.name)} <small>${groups[cfg.key] ? count + ' 處' : '未載入'}</small>`;
      box.appendChild(label);
      if (groups[cfg.key] && cfg.on) groups[cfg.key].addTo(map);
      label.querySelector('input').addEventListener('change', (ev) => {
        if (!groups[cfg.key]) return;
        if (ev.target.checked) groups[cfg.key].addTo(map); else groups[cfg.key].remove();
      });
    }
    status.textContent = missing.length ? `部分圖資未載入：${missing.join('、')}` : '圖資已載入，點地圖任一處查詢';
    status.classList.toggle('as-status-warn', missing.length > 0);
    setTimeout(() => { if (!missing.length) status.hidden = true; }, 4000);
  }

  // ---------- 互動：點地圖、搜尋、定位 ----------
  map.on('click', (e) => query(e.latlng.lat, e.latlng.lng, null));

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
          map.setView([lat, lon], 15);
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
    if (!navigator.geolocation) { alertStatus('此瀏覽器不支援定位'); return; }
    alertStatus('定位中…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        map.setView([lat, lon], 15);
        query(lat, lon, '我目前的位置');
        status.hidden = true;
      },
      () => alertStatus('無法取得位置（請允許定位權限）'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
  function alertStatus(msg) { status.hidden = false; status.textContent = msg; }

  // 給自動化測試使用的掛鉤（只能查詢，不會改資料）
  window.__fdeAirspace = { map, query };

  init();
})();
