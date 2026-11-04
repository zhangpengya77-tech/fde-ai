/* AI PID & Filter Lab 前端：統一介面，所有數值都來自後端真實分析結果。 */
(function () {
  'use strict';
  const API = '/api/live/pid-lab';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const fmt = (v, unit) => (v === null || v === undefined ? '—' : (Array.isArray(v) ? v.join('、') : v) + (unit ? ' ' + unit : ''));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pidlab.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pidlab.' + k, JSON.stringify(v)); } catch (e) { /* 無痕模式略過 */ } },
  };

  const VIEWS = [
    ['learn', '1 認識 PID'], ['aircraft', '2 飛控與飛機'], ['upload', '3 上傳'], ['health', '4 健康報告'],
    ['pid', '5 PID / 濾波'], ['advice', '6 AI 建議'], ['review', '7 教師審核'], ['export', '8 匯出'],
    ['verify', '9 安全驗證'], ['compare', '10 前後比較'], ['records', '報告與檔案'], ['library', '標準參數庫'],
  ];
  const ECO_INFO = {
    betaflight: { title: 'Betaflight', sub: 'FPV 穿越機、2.5 寸及五寸教學機', logs: 'Blackbox BBL / BFL' },
    ardupilot: { title: 'ArduPilot', sub: 'Pixhawk / Mission Planner，相容舊版 APM；F450、多旋翼教學機、行業機', logs: 'DataFlash BIN' },
    px4: { title: 'PX4', sub: 'PX4 Autopilot / QGroundControl；研發與行業飛控', logs: 'ULog (.ulg)' },
    other: { title: '其他飛控', sub: '手動填寫品牌、硬體、韌體與機型', logs: '僅建立檔案，不支援分析' },
  };
  const AXIS = { roll: '橫滾 Roll', pitch: '俯仰 Pitch', yaw: '偏航 Yaw' };
  const COURSES = [
    { level: 'L1', title: '基礎教學', goals: ['理解 P、I、D、FF 的作用', '理解濾波與延遲的取捨', '能讀 Blackbox / 日誌曲線'], steps: ['閱讀第一步說明', '上傳教師提供的示範日誌', '指出目標與實際曲線的差異'] },
    { level: 'L2', title: '應用實訓', goals: ['上傳自己的真實日誌', '識別振盪與雜訊', '理解 AI 建議與證據'], steps: ['建立飛機檔案並匯入 CLI / 參數', '上傳 BASELINE 日誌', '寫下自主判斷並送審', '教師審核 PASS / NG 後手動修改', '實飛複測並上傳 AFTER_TUNING'] },
    { level: 'L3', title: '專業實訓', goals: ['控制響應與系統辨識基礎', '不同載荷 / 參數版本比較', '撰寫完整實驗報告'], steps: ['同一機體不同載荷各飛一次', '比較階躍響應與頻譜', '管理參數版本', '完成前後比較與報告'] },
  ];
  const VERIFY = [
    '修改前已在官方工具完整備份原始配置（Betaflight diff all / Mission Planner 或 QGC 參數存檔）',
    '連接飛控修改參數時已拆下所有螺旋槳',
    '只修改了教師核准的參數，未改動馬達資源映射、接收機、失控保護與解鎖設定',
    '馬達轉向、螺旋槳方向與安裝牢固度已確認',
    '電池電量充足、電壓正常，飛行場地淨空且有教師在場',
    '先在低高度懸停 30 秒，確認無異常抖動、異音或馬達過熱',
    '再依指定動作完成複測飛行，落地後檢查馬達溫度',
    '複測日誌已上傳為 AFTER_TUNING 並完成前後比較',
  ];

  const state = { meta: null, online: false, ident: null, eco: store.get('eco', 'betaflight'), aircraft: [], logs: [], plans: [], currentLog: store.get('log', null), analysis: null, editingAircraft: null };

  function devHeader() {
    if (!state.meta || !state.meta.dev_mode) return {};
    return { 'X-PidLab-Dev-Identity': $('#dev-role').value };
  }
  function csrf() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? { 'X-CSRFToken': decodeURIComponent(m[1]) } : {};
  }
  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, devHeader(), csrf(), opts.headers || {});
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
    const res = await fetch(API + path, { method: opts.method || 'GET', headers, body: opts.body, credentials: 'same-origin' });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
      const err = new Error(msg); err.status = res.status; err.data = data; throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------- 路由
  function renderSteps() {
    $('#steps').innerHTML = VIEWS.map(([k, label]) => `<a href="#${k}" data-view-link="${k}">${label}</a>`).join('');
  }
  function show(view) {
    if (!VIEWS.some(([k]) => k === view)) view = 'learn';
    $$('.view').forEach((s) => s.classList.toggle('hidden', s.dataset.view !== view));
    $$('#steps a').forEach((a) => (a.dataset.viewLink === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const loaders = { health: renderHealth, pid: renderPid, advice: renderAdvice, review: loadReview, export: loadExport, compare: loadCompare, records: loadRecords, library: loadLibrary };
    if (loaders[view]) loaders[view]();
  }
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  // ---------------------------------------------------------------- 連線與身分
  async function probe() {
    const banner = $('#service-banner');
    try {
      state.meta = await api('/meta');
      state.online = true;
      if (state.meta.dev_mode) {
        $('#dev-role').classList.remove('hidden');
        $('#dev-role').value = store.get('devRole', $('#dev-role').value);
        state.meta = await api('/meta');
      }
      state.ident = state.meta.identity;
      banner.className = 'status-banner online';
      banner.textContent = `分析服務在線（${state.meta.pipeline_version}）。${state.meta.privacy}`;
      if (state.meta.dev_mode) banner.textContent += '　⚠ 本機開發模式：身分由開發選單模擬，非正式登入。';
      $('#identity-chip').textContent = state.ident ? `${state.ident.role === 'teacher' ? '教師' : '學員'} · ${state.ident.sub}` : '未登入';
    } catch (e) {
      state.online = false;
      banner.className = 'status-banner offline';
      banner.innerHTML = e.status === 401 || e.status === 403
        ? '請先<a href="/login/">登入 FDE-AI 平台</a>，再使用日誌分析功能。課程內容可直接瀏覽。'
        : '分析後端目前離線或此環境（例如 GitHub Pages 靜態站）沒有可用的 HTTPS 後端：可以瀏覽課程與說明，但無法上傳與分析日誌，也不會顯示任何分析結果。';
      $('#identity-chip').textContent = '離線';
    }
    document.body.classList.toggle('is-teacher', !!(state.ident && state.ident.role === 'teacher'));
    $$('.teacher-only').forEach((el) => el.classList.toggle('hidden', !(state.ident && state.ident.role === 'teacher')));
  }

  // ---------------------------------------------------------------- 第一步：課程
  function renderCourses() {
    $('#course-list').innerHTML = COURSES.map((c) => `
      <article class="card"><h3>${c.level}｜${c.title}</h3>
        <p class="muted">學習目標</p><ul>${c.goals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
        <p class="muted" style="margin-top:6px">操作步驟</p><ol>${c.steps.map((g) => `<li>${esc(g)}</li>`).join('')}</ol>
        <p class="kv">每項任務：上傳資料 → AI 分析 → 學員判斷 → 教師審核 PASS / NG → 成長紀錄</p>
      </article>`).join('');
  }

  // ---------------------------------------------------------------- 第二步：飛控與飛機
  function renderEcoCards() {
    const meta = state.meta ? Object.fromEntries(state.meta.ecosystems.map((e) => [e.key, e])) : {};
    $('#eco-cards').innerHTML = Object.entries(ECO_INFO).map(([k, info]) => `
      <button type="button" class="eco-card" data-eco="${k}" aria-pressed="${state.eco === k}">
        <b>${info.title}</b><small>${info.sub}</small><small>日誌：${info.logs}</small>
        ${meta[k] ? `<span class="support ${meta[k].status}">${meta[k].status === 'PARTIAL' ? '部分驗收' : '僅檔案'}</span><small>${esc(meta[k].note)}</small>` : ''}
      </button>`).join('');
    $$('.eco-card').forEach((b) => b.addEventListener('click', () => { state.eco = b.dataset.eco; store.set('eco', state.eco); $('#aircraft-eco').value = state.eco; renderEcoCards(); toggleOther(); }));
    $('#aircraft-eco').innerHTML = Object.entries(ECO_INFO).map(([k, i]) => `<option value="${k}">${i.title}</option>`).join('');
    $('#aircraft-eco').value = state.eco;
  }
  function toggleOther() { $('#other-fields').classList.toggle('hidden', $('#aircraft-eco').value !== 'other'); }

  async function loadAircraft() {
    if (!state.online || !state.ident) { $('#aircraft-list').innerHTML = '<p class="muted">後端離線或未登入。</p>'; return; }
    const data = await api('/aircraft');
    state.aircraft = data.aircraft;
    $('#aircraft-list').innerHTML = state.aircraft.length ? state.aircraft.map((a) => `
      <div class="list-item"><div><b>${esc(a.name)}</b> · ${ECO_INFO[a.ecosystem].title} ${esc(a.data.firmware_version || '')} <span class="muted">${esc(a.data.fc_model || a.data.other_hardware || '')} ${esc(a.data.frame || '')}</span><div class="kv">${esc(a.id)} · ${a.owner_sub}</div></div>
      <div class="actions"><button type="button" class="btn-secondary" data-edit="${a.id}">編輯</button></div></div>`).join('') : '<p class="muted">尚未建立飛機檔案。</p>';
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editAircraft(b.dataset.edit)));
    const sel = $('#upload-aircraft');
    const keep = store.get('aircraft', null);
    sel.innerHTML = state.aircraft.map((a) => `<option value="${a.id}">${esc(a.name)}（${ECO_INFO[a.ecosystem].title}）</option>`).join('');
    if (keep && state.aircraft.some((a) => a.id === keep)) sel.value = keep;
    uploadHint();
  }
  function editAircraft(id) {
    const a = state.aircraft.find((x) => x.id === id);
    if (!a) return;
    state.editingAircraft = id;
    const f = $('#aircraft-form');
    f.name.value = a.name;
    f.ecosystem.value = a.ecosystem;
    Object.entries(a.data).forEach(([k, v]) => { if (f.elements[k]) f.elements[k].value = v; });
    $('#aircraft-form-title').textContent = '編輯飛機檔案：' + a.name;
    toggleOther();
    f.scrollIntoView({ behavior: 'smooth' });
  }
  async function saveAircraft(ev) {
    ev.preventDefault();
    const f = ev.target;
    const data = {};
    $$('input, textarea', f).forEach((el) => { if (el.name && el.name !== 'name' && el.value.trim()) data[el.name] = el.value.trim(); });
    const body = { name: f.name.value.trim(), ecosystem: f.ecosystem.value, data };
    try {
      const row = state.editingAircraft ? await api('/aircraft/' + state.editingAircraft, { method: 'PUT', json: body }) : await api('/aircraft', { method: 'POST', json: body });
      store.set('aircraft', row.id);
      state.editingAircraft = null;
      $('#aircraft-form-title').textContent = '已儲存：' + row.name;
      await loadAircraft();
    } catch (e) { alert(e.message); }
  }

  // ---------------------------------------------------------------- 第三步：上傳
  function selectedAircraft() { return state.aircraft.find((a) => a.id === $('#upload-aircraft').value); }
  function uploadHint() {
    const a = selectedAircraft();
    $('#upload-eco-hint').textContent = a ? `飛控：${ECO_INFO[a.ecosystem].title}；可上傳 ${ECO_INFO[a.ecosystem].logs}。` : '請先建立飛機檔案。';
    $('#log-submit').disabled = !a || a.ecosystem === 'other';
  }
  async function importParams() {
    const a = selectedAircraft();
    if (!a) return alert('請先選擇飛機');
    let text = $('#param-text').value;
    const file = $('#param-file').files[0];
    if (!text && file) text = await file.text();
    try {
      const r = await api(`/aircraft/${a.id}/params`, { method: 'POST', json: { text, kind: $('#param-kind').value } });
      $('#param-result').textContent = `已匯入 ${r.count} 個參數` + (r.firmware ? `；CLI 版本：${r.firmware.name} ${r.firmware.version} ${r.firmware.target || ''}` : '') + (r.board ? `；board_name ${r.board}` : '') + '。下次上傳的日誌會一併使用。';
    } catch (e) { $('#param-result').textContent = '匯入失敗：' + e.message; }
  }
  async function uploadLog() {
    const a = selectedAircraft();
    const file = $('#log-file').files[0];
    const status = $('#upload-status');
    if (!a || !file) { status.textContent = '請選擇飛機與日誌檔案。'; return; }
    const q = new URLSearchParams({ aircraft_id: a.id, filename: file.name, phase: $('#upload-phase').value });
    [['battery_id', '#cond-battery'], ['props', '#cond-props'], ['payload', '#cond-payload'], ['wind', '#cond-wind'], ['param_version', '#cond-param']].forEach(([k, s]) => { if ($(s).value) q.set(k, $(s).value); });
    status.textContent = `上傳中（${(file.size / 1048576).toFixed(1)} MB）…`;
    try {
      const r = await api('/logs?' + q.toString(), { method: 'POST', body: await file.arrayBuffer(), headers: { 'Content-Type': 'application/octet-stream' } });
      if (r.duplicate) status.textContent = r.message;
      selectLog(r.log.id);
      pollLog(r.log.id);
    } catch (e) { status.innerHTML = `<span class="badge FAILED">失敗</span> ${esc(e.message)}`; }
  }
  async function pollLog(id) {
    const status = $('#upload-status');
    for (let i = 0; i < 240; i++) {
      const log = await api('/logs/' + id);
      status.innerHTML = `<span class="badge ${log.status}">${log.status}</span> ${esc(log.filename)} · SHA-256 ${log.sha256.slice(0, 12)}… ${log.error ? esc(log.error) : ''}`;
      if (log.status === 'DONE') { await loadLogs(); await openLog(id); status.innerHTML += ' — 分析完成，請查看「4 健康報告」。'; return; }
      if (log.status === 'FAILED') { await loadLogs(); return; }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  async function loadLogs() {
    if (!state.online || !state.ident) return;
    const data = await api('/logs');
    state.logs = data.logs;
    $('#log-list').innerHTML = state.logs.length ? state.logs.map((l) => `
      <div class="list-item ${l.id === state.currentLog ? 'selected' : ''}"><div><span class="badge ${l.status}">${l.status}</span> <b>${esc(l.filename)}</b> · ${l.phase} · ${l.summary ? `${esc(l.summary.firmware)} ${esc(l.summary.firmware_version)} · ${esc(l.summary.board)} · 健康分 ${fmt(l.summary.health_score)}` : esc(l.error || '')}
        <div class="kv">${l.id} · ${new Date(l.created_at * 1000).toLocaleString()} · ${l.owner_sub}</div></div>
        ${l.status === 'DONE' ? `<button type="button" class="btn-secondary" data-open="${l.id}">查看分析</button>` : ''}</div>`).join('') : '<p class="muted">尚無日誌。</p>';
    $$('[data-open]').forEach((b) => b.addEventListener('click', async () => { await openLog(b.dataset.open); location.hash = 'health'; }));
  }
  function selectLog(id) { state.currentLog = id; store.set('log', id); }
  async function openLog(id) {
    selectLog(id);
    state.analysis = await api(`/logs/${id}/analysis?params=0`);
    return state.analysis;
  }
  async function ensureAnalysis(target) {
    if (state.analysis) return state.analysis;
    if (!state.currentLog || !state.online) { $(target).innerHTML = '<p class="muted">尚未選擇已完成分析的日誌。後端離線時不顯示任何結果。</p>'; return null; }
    try { return await openLog(state.currentLog); } catch (e) { $(target).innerHTML = `<p class="muted">${esc(e.message)}</p>`; return null; }
  }
  function headLine(a) {
    const f = a.flight;
    return `<div class="card"><b>${esc(f.firmware_version.name)} ${esc(f.firmware_version.version)}</b> · ${esc(f.hardware.board)} · ${esc(f.vehicle_type)} · ${f.log_metadata.duration_s} 秒 · ${esc(f.log_metadata.format)}
      <div class="kv">日誌 ${esc(a.log.filename)} · SHA-256 ${esc(a.log.sha256)} · ${esc(a.pipeline_version)} / ${esc(a.algorithm_version)}<br>韌體識別來源：${esc(f.firmware_version.source)}；參數快照：${esc(f.parameter_snapshot.source)}（${f.parameter_snapshot.count} 項）</div>
      ${f.warnings.length ? `<ul class="kv">${f.warnings.map((w) => `<li>⚠ ${esc(w)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- 第四步：八大健康
  const STATUS_LABEL = { PASS: '正常', WARN: '風險', FAIL: '異常', 'N/A': '不適用', INSUFFICIENT: '資料不足' };
  async function renderHealth() {
    const a = await ensureAnalysis('#health-head');
    if (!a) return;
    $('#health-head').innerHTML = headLine(a);
    const o = a.health.overall;
    $('#health-overall').innerHTML = `<div class="card overall"><div><span class="muted">綜合分</span><div class="score">${fmt(o.score)}</div></div>
      <div>已評估 ${o.evaluated} / 適用 ${o.applicable} 項；不適用 ${o.not_applicable}；資料不足 ${o.insufficient}<br>覆蓋率 ${(o.coverage * 100).toFixed(0)}% · ${o.comparable ? '可與同條件飛行比較' : '<b>覆蓋率不足，不可與其他飛行直接比較或排名</b>'}<div class="kv">${esc(o.rule)}</div></div></div>`;
    $('#health-cards').innerHTML = a.health.indicators.map((i) => `
      <article class="card health-card"><div class="top"><b>${esc(i.label)}</b><span class="badge ${i.status === 'N/A' ? 'NA' : i.status}">${i.status} ${STATUS_LABEL[i.status]}</span></div>
        <p>${esc(i.summary)}</p>
        ${i.evidence.length ? `<ul>${i.evidence.map((e) => `<li>${esc(e.metric)}：<b>${esc(fmt(e.value, e.unit))}</b>${e.warn !== undefined ? ` <span class="muted">（注意 ${e.warn}${e.fail !== undefined ? ' / 異常 ' + e.fail : ''}）</span>` : ''}</li>`).join('')}</ul>` : ''}
        <div class="kv">資料來源：${esc(i.data_sources.join('、') || '—')}<br>覆蓋率 ${(i.coverage * 100).toFixed(0)}% · 可信度 ${esc(i.confidence)} · 閾值：${esc(i.threshold_source)}${i.limitations.length ? '<br>限制：' + esc(i.limitations.join('；')) : ''}</div>
      </article>`).join('');
  }

  // ---------------------------------------------------------------- 第五步：PID 與濾波
  async function renderPid() {
    const a = await ensureAnalysis('#pid-head');
    if (!a) return;
    $('#pid-head').innerHTML = headLine(a);
    const rl = a.control.rate_loop;
    $('#pid-axes').innerHTML = Object.entries(rl).map(([axis, r]) => {
      const st = r.step || {};
      if (r.status !== 'OK') return `<div class="card"><h3>${AXIS[axis]} · 角速度內環 <span class="badge INSUFFICIENT">INSUFFICIENT</span></h3><p class="muted">${esc(r.reason)}</p></div>`;
      return `<div class="card"><h3>${AXIS[axis]} · 角速度內環</h3>
        <div class="axis-metrics">
          <div class="metric"><b>${fmt(st.overshoot_pct, '%')}</b><span>過衝</span></div>
          <div class="metric"><b>${fmt(st.rise_time_ms, 'ms')}</b><span>上升時間 10→90%</span></div>
          <div class="metric"><b>${fmt(st.latency_50_ms, 'ms')}</b><span>50% 響應延遲</span></div>
          <div class="metric"><b>${fmt(st.settling_ms, 'ms')}</b><span>穩定時間 ±5%</span></div>
          <div class="metric"><b>${fmt(r.tracking_norm)}</b><span>正規化追蹤誤差</span></div>
          <div class="metric"><b>${fmt(r.tracking_rms_dps, 'deg/s')}</b><span>追蹤誤差 RMS</span></div>
          <div class="metric"><b>${fmt(r.delay_ms, 'ms')}</b><span>互相關延遲</span></div>
          <div class="metric"><b>${fmt(st.windows)}</b><span>有效操控視窗</span></div>
        </div>
        <div class="grid-2">
          <div><canvas class="chart" id="trace-${axis}"></canvas><div class="chart-legend">— 實際角速度（${esc(r.sources.actual)}）　- - 目標（${esc(r.sources.setpoint)}${r.sources.setpoint_derived ? '，推導值' : ''}）· 最活躍 4 秒</div></div>
          <div><canvas class="chart" id="step-${axis}"></canvas><div class="chart-legend">階躍響應（Wiener 反卷積，${st.status === 'OK' ? st.windows + ' 個視窗平均' : esc(st.reason || '資料不足')}）</div></div>
        </div>
        <div class="kv">取樣 ${r.sample_rate_hz} Hz · 分析視窗 ${r.window.start_s}–${r.window.end_s} s · 有效 ${(r.window.valid_ratio * 100).toFixed(0)}% · ${esc(r.tracking_scope || '')}${r.oscillation ? ` · 誤差頻譜峰值 ${r.oscillation.peak_hz} Hz（顯著度 ${r.oscillation.prominence}）` : ''}${r.note ? '<br>' + esc(r.note) : ''}</div></div>`;
    }).join('');
    Object.entries(rl).forEach(([axis, r]) => {
      if (r.status !== 'OK') return;
      LabCharts.drawLines($('#trace-' + axis), [
        { x: r.trace.t, y: r.trace.setpoint, color: '#f59e0b', dash: [5, 4] },
        { x: r.trace.t, y: r.trace.actual, color: '#38bdf8' },
      ], { xlabel: 's' });
      if (r.step && r.step.status === 'OK') LabCharts.drawLines($('#step-' + axis), [{ x: r.step.curve.t_ms, y: r.step.curve.y, color: '#10b981', width: 2 }], { xlabel: 'ms', ymin: 0, hlines: [{ y: 1, color: '#94abc2' }] });
      else LabCharts.drawLines($('#step-' + axis), [], {});
    });
    const sp = a.control.spectra;
    $('#pid-spectra').innerHTML = Object.keys(sp).length ? Object.entries(sp).map(([k, s]) => s.status !== 'OK'
      ? `<div class="card"><b>${esc(k)}</b> <span class="badge INSUFFICIENT">INSUFFICIENT</span><p class="muted">${esc(s.reason)}</p></div>`
      : `<div class="card"><b>${esc(s.label)}</b><canvas class="chart" id="spec-${k.replace(/\W/g, '_')}"></canvas>
        <div class="kv">來源 ${esc(s.source)} · ${s.rate_hz} Hz（Nyquist ${s.nyquist_hz} Hz）· Welch / Hann / ${s.window.nperseg} 點 / 50% 重疊 · 使用 ${s.window.seconds_used} s（飛行中）<br>峰值：${fmt(s.peaks_hz, 'Hz')} · 雜訊 RMS 80–200 Hz：${fmt(s.noise_rms['80_200hz'] && s.noise_rms['80_200hz'].toFixed(2))}</div></div>`).join('') : '<p class="muted">沒有頻譜資料。</p>';
    Object.entries(sp).forEach(([k, s]) => { if (s.status === 'OK') LabCharts.drawLines($('#spec-' + k.replace(/\W/g, '_')), [{ x: s.curve.f, y: s.curve.db, color: '#a78bfa' }], { xlabel: 'Hz' }); });
    const att = a.control.attitude_loop;
    const fe = a.control.filter_effect;
    const feHtml = fe ? `<div class="card"><h3>濾波實測效果（濾波前 → 濾波後）</h3><div class="table-wrap"><table><tr><th>軸</th><th>20–80 Hz</th><th>80–200 Hz</th><th>200 Hz 以上</th><th>濾波前峰值</th><th>濾波後峰值</th></tr>${Object.entries(fe).map(([ax, r]) => `<tr><td>${AXIS[ax]}</td><td>${fmt(r.attenuation_db['20_80hz'], 'dB')}</td><td>${fmt(r.attenuation_db['80_200hz'], 'dB')}</td><td>${fmt(r.attenuation_db['200hz_plus'], 'dB')}</td><td>${fmt(r.pre_peaks_hz.slice(0, 3), 'Hz')}</td><td>${fmt(r.post_peaks_hz.slice(0, 3), 'Hz')}</td></tr>`).join('')}</table></div><p class="kv">負值代表雜訊被衰減；資料來自 IMU 批次取樣，只計算飛行中的批次。</p></div>` : '';
    $('#pid-attitude').innerHTML = feHtml + `<div class="card"><h3>姿態外環</h3>${att.note ? `<p class="muted">${esc(att.note)}</p>` : Object.entries(att).filter(([ax]) => AXIS[ax]).map(([ax, v]) => `<p>${AXIS[ax]}：${v.status === 'OK' ? `誤差 RMS ${v.tracking_rms_deg}°、最大 ${v.max_error_deg}°（${esc(v.sources.actual)} vs ${esc(v.sources.setpoint)}，${v.sample_rate_hz} Hz${v.excluded_upset_s ? `；已排除翻覆段 ${v.excluded_upset_s} s` : ''}）` : esc(v.reason)}</p>`).join('')}${att.upsets ? `<p class="kv">⚠ 翻覆 / 失控姿態段（|角度| > 80°）：${att.upsets.map((u) => `${u.start_s}–${u.end_s} s（${esc(u.axis)} 峰值 ${u.peak_deg}°）`).join('；')}。此段不計入追蹤誤差，請對照事件紀錄確認是否墜機。</p>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- 第六步：建議
  async function renderAdvice() {
    const a = await ensureAnalysis('#advice-head');
    if (!a) return;
    const adv = a.advice;
    $('#advice-head').innerHTML = headLine(a) + `<div class="card"><p style="white-space:pre-line">${esc(adv.explanation)}</p><div class="kv">${esc(adv.disclaimer)}<br>規則 ${esc(adv.ruleset_version)} · 參數目錄 ${esc(adv.catalog)}</div></div>`;
    $('#advice-list').innerHTML = adv.suggestions.map((s) => `
      <article class="card suggestion ${s.level}"><div class="actions" style="justify-content:space-between"><b>${esc(s.id)} · ${esc(s.title)}</b><span class="badge ${s.level}">${s.level}</span></div>
        <dl>
          <dt>觀察</dt><dd>${esc(s.observation)}</dd>
          <dt>證據</dt><dd>${s.evidence.map((e) => `${esc(e.metric)}：<b>${esc(fmt(e.value, e.unit))}</b>`).join('；') || '—'}</dd>
          ${s.hardware_check ? `<dt>硬體檢查</dt><dd>${esc(s.hardware_check)}</dd>` : ''}
          ${s.params.length ? `<dt>參數</dt><dd><div class="table-wrap"><table><tr><th>參數</th><th>目前</th><th>建議</th><th>範圍</th><th>驗證</th></tr>${s.params.map((p) => `<tr><td>${esc(p.name || p.role)}</td><td>${fmt(p.current)}</td><td>${p.status === 'OK' ? `<b>${fmt(p.proposed)}</b>${p.change_pct ? ` (${p.change_pct > 0 ? '+' : ''}${p.change_pct}%)` : ''}` : '—'}</td><td>${p.range ? p.range.join('～') : '—'}</td><td>${esc(p.status === 'OK' ? p.validated_by : p.reason)}</td></tr>`).join('')}</table></div></dd>` : ''}
          ${s.direction ? `<dt>調整方向</dt><dd>${esc(s.direction)}</dd>` : ''}
          ${s.risk ? `<dt>風險</dt><dd>${esc(s.risk)}</dd>` : ''}
          ${s.retest ? `<dt>複測方法</dt><dd>${esc(s.retest)}</dd>` : ''}
          <dt>可信度</dt><dd>${esc(s.confidence)} · 證據完整度 ${(s.evidence_completeness * 100).toFixed(0)}%</dd>
        </dl>
        ${s.level === 'REVIEW' ? `<label class="actions" style="flex-direction:row"><input type="checkbox" data-sugg="${s.id}" style="width:auto"> 納入送審方案</label>` : ''}
      </article>`).join('');
    const can = adv.suggestions.some((s) => s.level === 'REVIEW') && !adv.blocked && state.ident && state.ident.role === 'student';
    $('#advice-actions').classList.toggle('hidden', !can);
  }
  async function submitPlan() {
    const ids = $$('[data-sugg]:checked').map((c) => c.dataset.sugg);
    try {
      const plan = await api(`/logs/${state.currentLog}/plans`, { method: 'POST', json: { suggestion_ids: ids, note: $('#plan-note').value } });
      $('#plan-status').innerHTML = `<span class="badge PENDING_REVIEW">PENDING_REVIEW</span> 方案 ${plan.id} 已送交教師審核。`;
    } catch (e) { $('#plan-status').textContent = e.message; }
  }

  // ---------------------------------------------------------------- 第七步：教師審核
  function planCard(p, editable) {
    return `<article class="card"><div class="actions" style="justify-content:space-between"><b>${esc(p.id)}</b><span class="badge ${p.status}">${p.status}</span></div>
      <div class="kv">學員 ${esc(p.owner_sub)} · 日誌 ${esc(p.log_id)} · 飛控 ${esc(p.ecosystem)} · 建議 ${esc(p.suggestion_ids.join('、'))} · ${new Date(p.created_at * 1000).toLocaleString()}</div>
      ${p.note ? `<p>學員判斷：${esc(p.note)}</p>` : ''}
      <div class="table-wrap"><table><tr><th>參數</th><th>目前</th><th>方案值</th><th>範圍</th></tr>
      ${p.changes.map((c) => `<tr><td>${esc(c.name)}</td><td>${fmt(c.current)}</td><td>${editable ? `<input type="number" step="any" data-val="${esc(c.name)}" value="${c.value}">` : `<b>${fmt(c.value)}</b>${c.teacher_modified ? '（教師修改）' : ''}`}</td><td>${c.range ? c.range.join('～') : ''}</td></tr>`).join('')}</table></div>
      ${p.reviewer ? `<p class="kv">審核：${esc(p.reviewer)} · ${new Date(p.reviewed_at * 1000).toLocaleString()} · ${esc(p.review_note)}</p>` : ''}
      ${editable ? `<textarea rows="2" data-note placeholder="審核意見（必填）：硬體檢查、安全提醒、複測要求"></textarea><div class="actions"><button type="button" class="btn-primary" data-decide="APPROVED">核准 PASS</button><button type="button" class="btn-danger" data-decide="REJECTED">退回 NG</button><span class="status-line" data-msg></span></div>` : ''}
    </article>`;
  }
  async function loadReview() {
    if (!state.online || !state.ident) { $('#review-list').innerHTML = '<p class="muted">後端離線或未登入。</p>'; return; }
    const data = await api('/plans');
    const teacher = state.ident.role === 'teacher';
    $('#review-list').innerHTML = data.plans.length ? data.plans.map((p) => `<div data-plan="${p.id}">${planCard(p, teacher && p.status === 'PENDING_REVIEW')}</div>`).join('') : '<p class="muted">目前沒有方案。</p>';
    $$('[data-plan]').forEach((wrap) => $$('[data-decide]', wrap).forEach((b) => b.addEventListener('click', async () => {
      const values = {};
      $$('[data-val]', wrap).forEach((i) => { values[i.dataset.val] = parseFloat(i.value); });
      try {
        await api(`/plans/${wrap.dataset.plan}/review`, { method: 'POST', json: { decision: b.dataset.decide, note: $('[data-note]', wrap).value, values } });
        loadReview();
      } catch (e) { $('[data-msg]', wrap).textContent = e.message; }
    })));
  }

  // ---------------------------------------------------------------- 第八步：匯出
  async function loadExport() {
    if (!state.online || !state.ident) { $('#export-list').innerHTML = '<p class="muted">後端離線或未登入。</p>'; return; }
    const data = await api('/plans');
    const approved = data.plans.filter((p) => p.status === 'APPROVED');
    if (!approved.length) { $('#export-list').innerHTML = '<p class="muted">沒有已審核通過的方案。</p>'; return; }
    const parts = await Promise.all(approved.map(async (p) => {
      try {
        const out = await api(`/plans/${p.id}/export`);
        return `<div class="card"><b>${esc(p.id)}</b> · ${esc(out.format)}<pre class="export">${esc(out.content)}</pre><a class="btn-secondary" href="${API}/plans/${p.id}/export?download=1" download>下載 ${esc(out.filename)}</a></div>`;
      } catch (e) { return `<div class="card"><b>${esc(p.id)}</b> <span class="badge BLOCKED">拒絕匯出</span> ${esc(e.message)}</div>`; }
    }));
    $('#export-list').innerHTML = parts.join('');
  }

  // ---------------------------------------------------------------- 第九步：安全驗證
  function renderVerify() {
    const done = store.get('verify', {});
    $('#verify-list').innerHTML = '<p class="muted">逐項確認後再進行複測飛行（勾選紀錄僅保存在本機瀏覽器）。</p>' + VERIFY.map((v, i) => `<label style="flex-direction:row;gap:8px;align-items:flex-start;margin:6px 0"><input type="checkbox" data-verify="${i}" style="width:auto" ${done[i] ? 'checked' : ''}> <span>${esc(v)}</span></label>`).join('');
    $$('[data-verify]').forEach((c) => c.addEventListener('change', () => { const d = store.get('verify', {}); d[c.dataset.verify] = c.checked; store.set('verify', d); }));
  }

  // ---------------------------------------------------------------- 第十步：前後比較
  async function loadCompare() {
    if (!state.online || !state.ident) { $('#cmp-result').innerHTML = '<p class="muted">後端離線或未登入。</p>'; return; }
    await loadLogs();
    const done = state.logs.filter((l) => l.status === 'DONE');
    const opt = (l) => `<option value="${l.id}">${l.phase} · ${esc(l.filename)} · ${new Date(l.created_at * 1000).toLocaleDateString()}</option>`;
    $('#cmp-base').innerHTML = done.filter((l) => l.phase !== 'AFTER_TUNING').map(opt).join('') + done.filter((l) => l.phase === 'AFTER_TUNING').map(opt).join('');
    $('#cmp-after').innerHTML = done.filter((l) => l.phase === 'AFTER_TUNING').map(opt).join('') + done.filter((l) => l.phase !== 'AFTER_TUNING').map(opt).join('');
    const list = await api('/comparisons');
    if (list.comparisons.length && !$('#cmp-result').innerHTML) $('#cmp-result').innerHTML = cmpCard(list.comparisons[0]);
  }
  function cmpCard(c) {
    const r = c.result;
    return `<div class="card"><h3>比較 ${esc(c.id)} <span class="badge ${r.outcome}">${r.outcome}</span></h3><p>${esc(r.reason)}</p>
      ${r.limitations.length ? `<ul class="kv">${r.limitations.map((l) => `<li>⚠ ${esc(l)}</li>`).join('')}</ul>` : ''}
      <div class="table-wrap"><table><tr><th>軸</th><th>指標</th><th>BASELINE</th><th>AFTER</th><th>變化</th><th>判定</th></tr>
      ${r.metrics.map((m) => `<tr><td>${esc(AXIS[m.axis] || '全部')}</td><td>${esc(m.metric)}</td><td>${fmt(m.baseline)}</td><td>${fmt(m.after)}</td><td>${m.change_pct !== undefined && m.change_pct !== null ? m.change_pct + '%' : '—'}</td><td><span class="badge ${m.verdict}">${m.verdict}</span></td></tr>`).join('')}</table></div>
      <div class="kv">${esc(r.rule)} · BASELINE ${esc(r.baseline && r.baseline.id)} · AFTER ${esc(r.after && r.after.id)}</div></div>`;
  }
  async function submitCompare() {
    try {
      const c = await api('/comparisons', { method: 'POST', json: { baseline_log_id: $('#cmp-base').value, after_log_id: $('#cmp-after').value } });
      $('#cmp-result').innerHTML = cmpCard(c);
    } catch (e) { $('#cmp-result').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }

  // ---------------------------------------------------------------- 報告與成長檔案
  async function loadRecords() {
    if (!state.online || !state.ident) { $('#report').innerHTML = '<p class="muted">後端離線或未登入。</p>'; return; }
    const rec = await api('/records');
    const done = rec.logs.filter((l) => l.status === 'DONE');
    $('#report-log').innerHTML = done.map((l) => `<option value="${l.id}" ${l.id === state.currentLog ? 'selected' : ''}>${l.phase} · ${esc(l.filename)}</option>`).join('');
    $('#growth').innerHTML = `<div class="table-wrap"><table><tr><th>時間</th><th>類型</th><th>內容</th><th>結果</th></tr>
      ${[...rec.logs.map((l) => ({ t: l.created_at, k: '日誌 ' + l.phase, c: l.filename, r: l.summary ? `健康分 ${fmt(l.summary.health_score)}` : l.status })),
         ...rec.plans.map((p) => ({ t: p.created_at, k: '調參方案', c: p.changes.map((c) => c.name + '→' + c.value).join('、'), r: p.status })),
         ...rec.comparisons.map((c) => ({ t: c.created_at, k: '前後比較', c: c.baseline_log + ' → ' + c.after_log, r: c.result.outcome }))]
        .sort((a, b) => b.t - a.t).map((x) => `<tr><td>${new Date(x.t * 1000).toLocaleString()}</td><td>${esc(x.k)}</td><td>${esc(x.c)}</td><td><span class="badge ${esc(x.r.split(' ')[0])}">${esc(x.r)}</span></td></tr>`).join('')}</table></div>`;
    if (done.length) renderReport(rec);
  }
  async function renderReport(rec) {
    const id = $('#report-log').value;
    if (!id) return;
    const a = await api(`/logs/${id}/analysis`);
    const log = rec.logs.find((l) => l.id === id);
    const plans = rec.plans.filter((p) => p.log_id === id);
    const cmps = rec.comparisons.filter((c) => c.baseline_log === id || c.after_log === id);
    const aircraft = rec.aircraft.find((x) => x.id === log.aircraft_id);
    const params = Object.entries(a.param_snapshot || {}).filter(([k]) => /(^[pidf]_(roll|pitch|yaw)$)|ATC_RAT|RATE_(RLL|PIT|YAW)|MC_.*RATE_|lowpass|lpf|GYRO_FILTER|HNTCH|IMU_GYRO|IMU_DGYRO|PID/i.test(k)).slice(0, 60);
    $('#report').innerHTML = `<div class="card report">
      <h3>FDE-AI PID 與濾波實訓報告</h3>
      <table>
        <tr><th>實驗編號</th><td>${esc(id)}</td><th>學員編號</th><td>${esc(log.owner_sub)}</td></tr>
        <tr><th>機體編號</th><td>${esc(log.aircraft_id)} ${aircraft ? esc(aircraft.name) : ''}</td><th>測試階段</th><td>${esc(log.phase)}</td></tr>
        <tr><th>飛控生態</th><td>${esc(a.flight.flight_controller_type)}</td><th>韌體版本</th><td>${esc(a.flight.firmware_version.name)} ${esc(a.flight.firmware_version.version)}</td></tr>
        <tr><th>硬體</th><td>${esc(a.flight.hardware.board)}</td><th>日誌哈希</th><td style="word-break:break-all">${esc(log.sha256)}</td></tr>
        <tr><th>測試條件</th><td colspan="3">${esc(Object.entries(log.conditions).map(([k, v]) => k + '=' + v).join('；') || '未填寫')}</td></tr>
        <tr><th>版本</th><td colspan="3">${esc(a.pipeline_version)} · ${esc(a.algorithm_version)} · ${esc(a.advice.ruleset_version)}</td></tr>
      </table>
      <h3>參數快照（PID / 濾波相關）</h3><div class="table-wrap"><table>${params.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('') || '<tr><td>無</td></tr>'}</table></div>
      <h3>八大健康指標</h3><p>綜合分 ${fmt(a.health.overall.score)}（覆蓋率 ${(a.health.overall.coverage * 100).toFixed(0)}%）</p>
      <table>${a.health.indicators.map((i) => `<tr><td>${esc(i.label)}</td><td><span class="badge ${i.status === 'N/A' ? 'NA' : i.status}">${i.status}</span></td><td>${esc(i.summary)}</td></tr>`).join('')}</table>
      <h3>關鍵控制指標</h3><table><tr><th>軸</th><th>過衝</th><th>上升時間</th><th>延遲</th><th>追蹤誤差</th></tr>${Object.entries(a.control.rate_loop).map(([ax, r]) => `<tr><td>${AXIS[ax]}</td><td>${fmt(r.step && r.step.overshoot_pct, '%')}</td><td>${fmt(r.step && r.step.rise_time_ms, 'ms')}</td><td>${fmt(r.delay_ms, 'ms')}</td><td>${fmt(r.tracking_norm)}${r.status !== 'OK' ? ' ' + esc(r.reason) : ''}</td></tr>`).join('')}</table>
      <h3>頻譜結果</h3><table>${Object.entries(a.control.spectra).map(([k, s]) => `<tr><td>${esc(s.label || k)}</td><td>${s.status === 'OK' ? `峰值 ${fmt(s.peaks_hz, 'Hz')}；80–200 Hz 雜訊 ${fmt(s.noise_rms['80_200hz'] && s.noise_rms['80_200hz'].toFixed(2))}` : esc(s.reason)}</td></tr>`).join('')}</table>
      <h3>AI 分析摘要</h3><p style="white-space:pre-line">${esc(a.advice.explanation)}</p>
      <h3>參數調整建議</h3><ul>${a.advice.suggestions.map((s) => `<li><span class="badge ${s.level}">${s.level}</span> ${esc(s.title)}${s.params.filter((p) => p.status === 'OK').map((p) => `：${esc(p.name)} ${p.current} → ${p.proposed}`).join('')}</li>`).join('')}</ul>
      <h3>教師審核紀錄</h3>${plans.length ? plans.map((p) => `<p>${esc(p.id)} <span class="badge ${p.status}">${p.status}</span> ${esc(p.reviewer || '')} ${esc(p.review_note || '')}</p>`).join('') : '<p>尚無。</p>'}
      <h3>修改前後對比</h3>${cmps.length ? cmps.map((c) => `<p>${esc(c.id)} <span class="badge ${c.result.outcome}">${c.result.outcome}</span> ${esc(c.result.reason)}</p>`).join('') : '<p>尚未比較。</p>'}
      <h3>最終結論</h3><p>${cmps.length ? `最近一次前後比較結果為 ${esc(cmps[0].result.outcome)}。` : '尚未完成複測比較，不能判定調參成功。'}${a.advice.blocked ? '本次日誌存在安全風險，已停止調參建議。' : ''}</p>
    </div>`;
  }

  // ---------------------------------------------------------------- 標準參數庫
  async function loadLibrary() {
    if (!state.online || !state.ident) { $('#library-list').innerHTML = '<p class="muted">後端離線或未登入。</p>'; return; }
    const data = await api('/library');
    const teacher = state.ident.role === 'teacher';
    $('#library-list').innerHTML = (data.note ? `<p class="muted">${esc(data.note)}</p>` : '') + (data.library.length ? data.library.map((l) => `
      <article class="card" data-lib="${l.id}"><div class="actions" style="justify-content:space-between"><b>${esc(l.data.teaching_model)} · ${esc(ECO_INFO[l.ecosystem].title)} ${esc(l.data.firmware_version)}</b><span class="badge ${l.status}">${l.status}</span></div>
        <div class="kv">${esc(l.id)} · 硬體 ${esc(l.data.fc_model || '—')} · 電機 ${esc(l.data.motor || '—')} · 槳 ${esc(l.data.prop || '—')} · 電池 ${esc(l.data.battery || '—')} · 建立 ${esc(l.created_by)}${l.approved_by ? ' · 核准 ' + esc(l.approved_by) : ''}</div>
        <p>原始：${esc(l.data.original_params || '—')}<br>優化：${esc(l.data.optimized_params || '—')}</p>
        <div class="kv">BASELINE ${esc(l.data.baseline_log_id || '—')} · AFTER ${esc(l.data.after_log_id || '—')} · 比較 ${esc(l.data.comparison_id || '—')}</div>
        ${teacher ? `<div class="actions">${['TESTING', 'APPROVED', 'RETIRED'].map((s) => `<button type="button" class="btn-secondary" data-status="${s}">標記 ${s}</button>`).join('')}<span class="status-line" data-msg></span></div>` : ''}
      </article>`).join('') : '<p class="muted">目前沒有可用的標準參數。</p>');
    $$('[data-lib]').forEach((card) => $$('[data-status]', card).forEach((b) => b.addEventListener('click', async () => {
      try { await api('/library/' + card.dataset.lib, { method: 'PUT', json: { status: b.dataset.status } }); loadLibrary(); } catch (e) { $('[data-msg]', card).textContent = e.message; }
    })));
  }
  async function createLibrary(ev) {
    ev.preventDefault();
    const body = {};
    $$('input, select, textarea', ev.target).forEach((el) => { if (el.name && el.value.trim()) body[el.name] = el.value.trim(); });
    try { await api('/library', { method: 'POST', json: body }); ev.target.reset(); loadLibrary(); } catch (e) { alert(e.message); }
  }

  // ---------------------------------------------------------------- 啟動
  async function init() {
    renderSteps();
    renderCourses();
    renderVerify();
    await probe();
    renderEcoCards();
    toggleOther();
    $('#aircraft-eco').addEventListener('change', () => { state.eco = $('#aircraft-eco').value; store.set('eco', state.eco); renderEcoCards(); toggleOther(); });
    $('#aircraft-form').addEventListener('submit', saveAircraft);
    $('#aircraft-new').addEventListener('click', () => { state.editingAircraft = null; $('#aircraft-form').reset(); $('#aircraft-eco').value = state.eco; $('#aircraft-form-title').textContent = '建立飛機檔案'; toggleOther(); });
    $('#upload-aircraft').addEventListener('change', () => { store.set('aircraft', $('#upload-aircraft').value); uploadHint(); });
    $('#param-submit').addEventListener('click', importParams);
    $('#log-submit').addEventListener('click', uploadLog);
    $('#plan-submit').addEventListener('click', submitPlan);
    $('#cmp-submit').addEventListener('click', submitCompare);
    $('#report-log').addEventListener('change', loadRecords);
    $('#report-print').addEventListener('click', () => window.print());
    $('#library-form').addEventListener('submit', createLibrary);
    $('#dev-role').addEventListener('change', () => { store.set('devRole', $('#dev-role').value); location.reload(); });
    try { await loadAircraft(); await loadLogs(); } catch (e) { /* 後端離線時已顯示狀態列 */ }
    show(location.hash.slice(1) || 'learn');
  }
  init();
})();
