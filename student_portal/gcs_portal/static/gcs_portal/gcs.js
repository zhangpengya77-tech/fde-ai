// FDE-GCS Web 1.0 介面。送出白名單在 mavlink/codec.js；參數寫入只能經過 mavlink/writer.js，且每次都需要教師批准。
import { VehicleLink } from './mavlink/link.js';
import { evaluateWriteChecks, validateChange, writeApprovedParam, WriteBlockedError } from './mavlink/writer.js';

const MODE_TEXT = {
  demo: ['DEMO 介面', '目前未連線任何飛控。畫面上沒有真實遙測，也沒有用假資料冒充遙測。'],
  real: ['真機模式（未連線）', '按「選擇 USB 並連線」，在瀏覽器視窗中手動選擇飛控的 COM 埠。本階段只讀取，不會寫入飛控。'],
  realConnected: ['真機模式（已連線）', '資料來自 USB 連線的飛控。沒有解鎖、切換模式或起飛功能；參數寫入只限白名單，且每次都要教師批准。'],
  sitl: ['仿真模式（未連線）', 'SITL 仿真連線在 P4 開放。目前沒有連線任何仿真。'],
};

const LINK_TEXT = {
  disconnected: '未連線',
  waiting: '等待飛控心跳…',
  ok: '正常',
  stale: '訊號中斷（超過 3 秒沒有心跳）',
  lost: '已斷線（超過 10 秒沒有心跳）',
};

const $ = (id) => document.getElementById(id);
let mode = 'demo';
let link = null;
let original = new Map();
let paramRound = 0;
let allowlist = null;
let requests = [];
let applyTarget = null;
const csrf = () => document.body.dataset.csrf;

function serialSupport() {
  if (!window.isSecureContext) return [false, '不可用：需要 HTTPS 或本機（localhost）網址'];
  if (!('serial' in navigator)) return [false, '不支援：請改用 Windows 桌面版 Chrome 或 Edge'];
  return [true, '可用（Chrome／Edge）'];
}

function setModeBar(key) {
  const [label, detail] = MODE_TEXT[key];
  $('gcsModeBar').setAttribute('data-mode', key.startsWith('real') ? 'real' : key);
  $('gcsModeLabel').textContent = label;
  $('gcsModeDetail').textContent = detail;
}

function render() {
  const connected = Boolean(link && link.connected);
  const state = link ? link.linkState() : 'disconnected';
  const [supported] = serialSupport();
  setModeBar(mode === 'real' ? (connected ? 'realConnected' : 'real') : mode);
  document.querySelectorAll('input[name="gcs-mode"]').forEach((input) => { input.disabled = connected; });
  $('gcsConnect').disabled = mode !== 'real' || !supported || connected;
  $('gcsDisconnect').disabled = !connected;
  $('gcsBaud').disabled = connected;
  $('gcsHeartbeat').textContent = LINK_TEXT[state];
  $('gcsHeartbeat').setAttribute('data-state', state);
  const vehicle = link && link.telemetry.vehicle;
  $('gcsIds').textContent = vehicle ? `${vehicle.sysid} ／ ${vehicle.compid}` : '—';
  if (link && link.message) $('gcsLinkMessage').textContent = link.message;
  renderTelemetry();
  renderParams();
}

function renderTelemetry() {
  const now = Date.now();
  document.querySelectorAll('[data-key]').forEach((cell) => {
    const value = link && link.telemetry.values[cell.dataset.key];
    cell.textContent = value ? value.text : '—';
    cell.classList.toggle('gcs-live', Boolean(value) && !link.telemetry.isStale(cell.dataset.key, now));
  });
}

function renderParams() {
  const downloader = link && link.params;
  const canRead = Boolean(link && link.linkState() === 'ok' && downloader.state !== 'downloading');
  $('gcsParamRead').disabled = !canRead;
  $('gcsParamRead').textContent = original.size ? '再讀一次並比對' : '讀取全部參數';
  $('gcsParamExport').disabled = !(downloader && downloader.params.size && downloader.state !== 'downloading');
  $('gcsParamSearch').disabled = !(downloader && downloader.params.size);
  $('gcsBackupUpload').disabled = !(downloader && downloader.params.size && ['complete', 'incomplete'].includes(downloader.state) && link.connected);
  if (!downloader || downloader.state === 'idle') return;
  const summary = downloader.summary();
  const progress = {
    downloading: `讀取中：${summary.received}／${summary.total ?? '?'}`,
    complete: `完成：共 ${summary.received} 個參數${summary.duplicates ? `（忽略重複 ${summary.duplicates} 筆）` : ''}`,
    incomplete: `未完整：收到 ${summary.received}／${summary.total}，缺少索引 ${summary.missing.slice(0, 20).join(', ')}${summary.missing.length > 20 ? '…' : ''}`,
    failed: `失敗：${summary.error}`,
  }[summary.state];
  $('gcsParamProgress').textContent = progress;
  if (summary.state !== 'downloading' && downloader.round !== paramRound) {
    downloader.round = paramRound;
    if (!original.size && summary.state === 'complete') {
      original = new Map(Array.from(downloader.params, ([name, p]) => [name, p.value]));
    }
    renderParamRows();
  }
}

function formatValue(value) {
  if (value === undefined) return '—';
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(7)));
}

function renderParamRows() {
  const body = $('gcsParamBody');
  const query = $('gcsParamSearch').value.trim().toUpperCase();
  const rows = Array.from(link.params.params.values())
    .filter((p) => !query || p.name.includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  body.replaceChildren();
  if (!rows.length) {
    const tr = body.insertRow();
    const td = tr.insertCell();
    td.colSpan = 5;
    td.textContent = query ? '沒有符合的參數。' : '沒有參數資料。';
    return;
  }
  for (const p of rows.slice(0, 500)) {
    const tr = body.insertRow();
    const before = original.get(p.name);
    const changed = before !== undefined && before !== p.value;
    tr.classList.toggle('gcs-changed', changed);
    for (const text of [p.name, formatValue(before), formatValue(p.value), p.typeName]) {
      tr.insertCell().textContent = text;
    }
    const nameCell = tr.cells[0];
    nameCell.textContent = '';
    const nameButton = document.createElement('button');
    nameButton.type = 'button';
    nameButton.className = 'gcs-link';
    nameButton.textContent = p.name;
    nameButton.title = '在 AI 調參助教顯示說明';
    nameButton.addEventListener('click', () => selectParam(p.name));
    nameCell.append(nameButton);
    const action = tr.insertCell();
    if (allowlist && allowlist.params[p.name]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gcs-mini';
      button.textContent = '申請修改';
      button.addEventListener('click', () => openWriteForm(p.name));
      action.append(button);
    }
  }
  if (rows.length > 500) {
    const td = body.insertRow().insertCell();
    td.colSpan = 5;
    td.textContent = `只顯示前 500 筆，共 ${rows.length} 筆；請用搜尋縮小範圍。`;
  }
}

function backupLines() {
  return Array.from(link.params.params.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name},${formatValue(p.value)}`);
}

function exportParams() {
  const vehicle = link.telemetry.vehicle;
  const firmware = link.telemetry.values.firmware ? link.telemetry.values.firmware.text : '未知';
  const stamp = new Date();
  const lines = [
    '# FDE-GCS 參數備份（唯讀匯出，未修改飛控）',
    `# 匯出時間：${stamp.toISOString()}`,
    `# 飛控：System ID ${vehicle.sysid} / Component ID ${vehicle.compid}，韌體 ${firmware}`,
    `# 下載狀態：${link.params.state}，${link.params.params.size} 個參數`,
    ...Array.from(link.params.params.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => `${p.name},${formatValue(p.value)}`),
  ];
  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const pad = (n) => String(n).padStart(2, '0');
  a.href = url;
  a.download = `fde-gcs-params-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.param`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function connect() {
  $('gcsConnect').disabled = true;
  original = new Map();
  link = new VehicleLink({ onUpdate: render });
  try {
    await link.connectSerial(navigator.serial, Number($('gcsBaud').value));
  } catch (error) {
    $('gcsLinkMessage').textContent = error.message;
    link = null;
  }
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  const [, supportText] = serialSupport();
  $('gcsSerialSupport').textContent = supportText;
  document.querySelectorAll('input[name="gcs-mode"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      mode = input.value;
      $('gcsLinkMessage').textContent = mode === 'real' ? '請按「選擇 USB 並連線」。使用前請先關閉其他地面站。' : 'SITL 仿真連線在 P4 開放。';
      render();
    });
  });
  $('gcsConnect').addEventListener('click', connect);
  $('gcsDisconnect').addEventListener('click', async () => {
    link.message = '已中斷連線。';
    await link.disconnect();
    render();
  });
  $('gcsParamRead').addEventListener('click', () => {
    try {
      paramRound += 1;
      link.startParamDownload();
    } catch (error) {
      $('gcsParamProgress').textContent = error.message;
    }
  });
  $('gcsParamExport').addEventListener('click', exportParams);
  $('gcsParamSearch').addEventListener('input', () => link && renderParamRows());
  $('gcsWriteNew').addEventListener('input', updateWriteForm);
  $('gcsWriteAck').addEventListener('change', updateWriteForm);
  $('gcsWriteSubmit').addEventListener('click', submitWriteRequest);
  $('gcsWriteClose').addEventListener('click', () => { $('gcsWriteForm').hidden = true; });
  $('gcsApplyAck').addEventListener('change', renderApplyPanel);
  $('gcsApplyGo').addEventListener('click', applyWrite);
  $('gcsApplyClose').addEventListener('click', () => { applyTarget = null; $('gcsApplyPanel').hidden = true; });
  $('gcsWriteClose').disabled = false;
  $('gcsApplyClose').disabled = false;
  $('gcsAiAsk').addEventListener('click', askAi);
  $('gcsBackupUpload').addEventListener('click', uploadBackup);
  $('gcsExport').addEventListener('click', () => {
    window.location.href = `/gcs/api/export.csv?cohort=${encodeURIComponent($('gcsExportCohort').value)}`;
  });
  loadAllowlist();
  refreshRequests();
  refreshResults();
  setInterval(() => { refreshRequests(); refreshResults(); }, 5000);
  setInterval(() => { if (link) render(); if (applyTarget) renderApplyPanel(); }, 500);
  render();
});

// ---- P3：參數寫入申請、教師批准、寫入飛控 ----

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.errors ? data.errors.join(' ') : data.error || `伺服器回應 ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function loadAllowlist() {
  try {
    allowlist = await api('/gcs/api/allowlist/');
    if (link && link.params.params.size) renderParamRows();
  } catch (error) {
    allowlist = null;
  }
}

async function refreshRequests() {
  try {
    requests = (await api('/gcs/api/param-requests/')).requests;
    renderRequests();
  } catch (error) {
    /* 下次再試 */
  }
}

function openWriteForm(name) {
  const entry = link && link.params.params.get(name);
  const rule = allowlist && allowlist.params[name];
  if (!entry || !rule) return;
  $('gcsWriteForm').hidden = false;
  $('gcsWriteForm').dataset.param = name;
  $('gcsWriteParam').textContent = `${name}（${rule.label}）`;
  $('gcsWriteRange').textContent = `允許範圍 ${rule.min}～${rule.max}，單次修改不超過 ${Math.round(allowlist.max_step_ratio * 100)}%。白名單版本 ${allowlist.version}。`;
  $('gcsWriteOld').textContent = formatValue(entry.value);
  $('gcsWriteNew').value = '';
  $('gcsWriteAck').checked = false;
  $('gcsWriteMessage').textContent = '';
  updateWriteForm();
  $('gcsWriteNew').focus();
}

function updateWriteForm() {
  const name = $('gcsWriteForm').dataset.param;
  const entry = link && link.params.params.get(name);
  const value = Number($('gcsWriteNew').value);
  const errors = entry && $('gcsWriteNew').value !== '' ? validateChange(allowlist, name, entry.value, value) : ['請輸入新值。'];
  $('gcsWriteMessage').textContent = $('gcsWriteNew').value === '' ? '' : errors.join(' ');
  $('gcsWriteSubmit').disabled = errors.length > 0 || !$('gcsWriteAck').checked || !link || link.linkState() !== 'ok';
}

async function submitWriteRequest() {
  const name = $('gcsWriteForm').dataset.param;
  const entry = link.params.params.get(name);
  $('gcsWriteSubmit').disabled = true;
  try {
    await api('/gcs/api/param-requests/', {
      method: 'POST',
      body: {
        param_name: name,
        old_value: entry.value,
        new_value: Number($('gcsWriteNew').value),
        vehicle_sysid: link.telemetry.vehicle.sysid,
        firmware: link.telemetry.values.firmware ? link.telemetry.values.firmware.text : '',
        safety_ack: $('gcsWriteAck').checked,
      },
    });
    $('gcsWriteForm').hidden = true;
    await refreshRequests();
  } catch (error) {
    $('gcsWriteMessage').textContent = error.message;
    updateWriteForm();
  }
}

function addButton(parent, text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gcs-mini';
  button.textContent = text;
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
}

async function decide(id, decision) {
  try {
    await api(`/gcs/api/param-requests/${id}/decision/`, { method: 'POST', body: { decision } });
  } catch (error) {
    window.alert(error.message);
  }
  refreshRequests();
}

async function cancelRequest(id) {
  try {
    await api(`/gcs/api/param-requests/${id}/cancel/`, { method: 'POST', body: {} });
  } catch (error) {
    window.alert(error.message);
  }
  refreshRequests();
}

function renderRequests() {
  const list = $('gcsRequestList');
  list.replaceChildren();
  if (!requests.length) {
    const li = document.createElement('li');
    li.textContent = '尚無申請。';
    list.append(li);
    return;
  }
  for (const item of requests.slice(0, 20)) {
    const li = document.createElement('li');
    li.dataset.status = item.status;
    const title = document.createElement('strong');
    title.textContent = `${item.param_name}：${formatValue(item.old_value)} → ${formatValue(item.new_value)}`;
    const meta = document.createElement('span');
    const who = item.is_mine ? '我' : `${item.requester}${item.cohort ? `（${item.cohort}）` : ''}`;
    const review = item.review_status ? ` · 教師覆核 ${item.review_label}` : '';
    meta.textContent = ` ${item.status_label} · ${who} · 飛控 ${item.vehicle_sysid}${item.result_message ? ` · ${item.result_message}` : ''}${review}`;
    li.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'gcs-actions';
    if (item.can_decide) {
      addButton(actions, '批准', () => decide(item.id, 'approve'));
      addButton(actions, '退回', () => decide(item.id, 'reject'));
    }
    if (isTeacher() && !item.is_mine && (item.status === 'APPLIED' || item.status === 'FAILED')) {
      addButton(actions, 'PASS', () => reviewItem(`/gcs/api/param-requests/${item.id}/review/`, 'PASS'));
      addButton(actions, 'NG', () => reviewItem(`/gcs/api/param-requests/${item.id}/review/`, 'NG'));
    }
    if (item.is_mine && item.status === 'APPROVED') {
      addButton(actions, '寫入飛控…', () => openApplyPanel(item.id));
    }
    if (item.is_mine && (item.status === 'PENDING' || item.status === 'APPROVED')) {
      addButton(actions, '取消申請', () => cancelRequest(item.id));
    }
    if (actions.childElementCount) li.append(actions);
    list.append(li);
  }
}

function openApplyPanel(id) {
  applyTarget = id;
  $('gcsApplyAck').checked = false;
  $('gcsApplyMessage').textContent = '';
  $('gcsApplyPanel').hidden = false;
  renderApplyPanel();
}

function renderApplyPanel() {
  const request = requests.find((r) => r.id === applyTarget);
  if (!request) {
    $('gcsApplyPanel').hidden = true;
    applyTarget = null;
    return;
  }
  const checks = evaluateWriteChecks({ link, request, allowlist, safetyAckNow: $('gcsApplyAck').checked, confirmed: true });
  const list = $('gcsChecklist');
  list.replaceChildren();
  for (const check of checks.filter((c) => c.key !== 'confirmed')) {
    const li = document.createElement('li');
    li.dataset.ok = String(check.ok);
    li.textContent = `${check.ok ? '✔' : '✘'} ${check.label}${!check.ok && check.detail ? `：${check.detail}` : ''}`;
    list.append(li);
  }
  $('gcsApplyGo').disabled = !checks.every((c) => c.ok);
}

async function applyWrite() {
  const request = requests.find((r) => r.id === applyTarget);
  if (!request) return;
  const confirmed = window.confirm(`確認把 ${request.param_name} 從 ${formatValue(request.old_value)} 改成 ${formatValue(request.new_value)}？\n請確認螺旋槳已拆下、動力電池已斷開。`);
  if (!confirmed) return;
  $('gcsApplyGo').disabled = true;
  $('gcsApplyMessage').textContent = '寫入中，等待飛控讀回…';
  let result;
  try {
    result = await writeApprovedParam({ link, request, allowlist, safetyAckNow: $('gcsApplyAck').checked, confirmed });
  } catch (error) {
    $('gcsApplyMessage').textContent = error instanceof WriteBlockedError ? error.message : `寫入失敗：${error.message}`;
    if (!(error instanceof WriteBlockedError)) {
      result = { success: false, readback: null, message: `寫入失敗：${error.message}` };
    } else {
      return;
    }
  }
  try {
    await api(`/gcs/api/param-requests/${request.id}/result/`, {
      method: 'POST',
      body: { success: result.success, readback_value: result.readback, message: result.message },
    });
  } catch (error) {
    result.message += `（結果回報伺服器失敗：${error.message}）`;
  }
  $('gcsApplyMessage').textContent = result.message;
  applyTarget = null;
  await refreshRequests();
  renderParamRows();
}

// ---- P5：AI 調參助教、學員成果、教師覆核 ----

const isTeacher = () => document.body.dataset.gcsRole === 'teacher';
let selectedParam = '';

function selectParam(name) {
  selectedParam = name;
  const entry = link && link.params.params.get(name);
  const rule = allowlist && allowlist.params[name];
  const text = allowlist && allowlist.explanations && allowlist.explanations.params[name];
  $('gcsAiIntro').hidden = true;
  $('gcsAiCard').hidden = false;
  $('gcsAiName').textContent = rule ? `${name}（${rule.label}）` : name;
  $('gcsAiValue').textContent = entry ? `${formatValue(entry.value)}（${entry.typeName}）` : '—';
  $('gcsAiRange').textContent = rule ? `${rule.min}～${rule.max}（ArduCopter 預設 ${rule.default}）` : '不在可修改的白名單內（只能查看）';
  $('gcsAiPurpose').textContent = text ? text.purpose : '教師尚未撰寫這個參數的說明，可以問 AI 助教。';
  $('gcsAiHigher').textContent = text ? text.higher : '—';
  $('gcsAiLower').textContent = text ? text.lower : '—';
  $('gcsAiRisk').textContent = text ? text.risk : '—';
  const status = allowlist && allowlist.explanations && allowlist.explanations.status;
  $('gcsAiSource').textContent = text ? `以上是教師撰寫的固定說明${status === 'APPROVED' ? '' : '（教師尚未最終確認）'}。` : '';
  $('gcsAiAnswer').textContent = '';
  $('gcsAiAsk').disabled = false;
}

async function askAi() {
  const name = selectedParam;
  const entry = link && link.params.params.get(name);
  const rule = allowlist && allowlist.params[name];
  $('gcsAiAsk').disabled = true;
  $('gcsAiAnswer').textContent = 'AI 助教思考中…';
  const question = `請用繁體中文、以無人機教官的口吻，向學員說明 ArduCopter 參數 ${name}`
    + `${entry ? `（目前值 ${formatValue(entry.value)}）` : ''}${rule ? `，教學允許範圍 ${rule.min}～${rule.max}` : ''}`
    + '：它的用途、調高與調低的影響、調整時的安全注意事項。只提供建議，不要給出直接套用的指令。';
  try {
    const data = await api('/api/public/rag/ask/', { method: 'POST', body: { question, locale: 'zh-TW' } });
    $('gcsAiAnswer').textContent = `AI 建議（僅供參考，不會寫入飛控）：${data.answer || '（沒有回答）'}`;
  } catch (error) {
    $('gcsAiAnswer').textContent = `AI 助教目前無法回答：${error.message}`;
  } finally {
    $('gcsAiAsk').disabled = false;
  }
}

async function reviewItem(url, result) {
  const note = window.prompt(`覆核結果 ${result}，可輸入備註（可留空）：`, '') ?? null;
  if (note === null) return;
  try {
    await api(url, { method: 'POST', body: { result, note } });
  } catch (error) {
    window.alert(error.message);
  }
  refreshRequests();
  refreshResults();
}

async function uploadBackup() {
  $('gcsBackupUpload').disabled = true;
  try {
    const summary = link.params.summary();
    await api('/gcs/api/backups/', {
      method: 'POST',
      body: {
        content: `${backupLines().join('\n')}\n`,
        vehicle_sysid: link.telemetry.vehicle.sysid,
        firmware: link.telemetry.values.firmware ? link.telemetry.values.firmware.text : '',
        missing_count: summary.missing.length,
      },
    });
    $('gcsResultMessage').textContent = '參數備份已上傳。';
    refreshResults();
  } catch (error) {
    $('gcsResultMessage').textContent = `上傳失敗：${error.message}`;
  }
  render();
}

async function showDiff(item) {
  try {
    const diff = await api(`/gcs/api/backups/${item.id}/diff/`);
    const body = $('gcsDiffBody');
    body.replaceChildren();
    $('gcsDiff').hidden = false;
    if (!diff.base_id) {
      $('gcsDiffTitle').textContent = `差異報告：備份 #${item.id} 是這台飛控的第一份備份，沒有可比對的對象`;
      return;
    }
    $('gcsDiffTitle').textContent = `差異報告：備份 #${item.id} 對比前一份 #${diff.base_id}（變更 ${diff.changed.length}、新增 ${diff.added.length}、移除 ${diff.removed.length}）`;
    const rows = [
      ...diff.changed.map((c) => [c.name, formatValue(c.before), formatValue(c.after)]),
      ...diff.added.map((n) => [n, '—', '新增']),
      ...diff.removed.map((n) => [n, '移除', '—']),
    ];
    if (!rows.length) rows.push(['沒有差異', '', '']);
    for (const row of rows) {
      const tr = body.insertRow();
      for (const text of row) tr.insertCell().textContent = text;
    }
  } catch (error) {
    $('gcsResultMessage').textContent = `無法取得差異報告：${error.message}`;
  }
}

async function refreshResults() {
  try {
    const [summary, backupData] = await Promise.all([api('/gcs/api/summary/'), api('/gcs/api/backups/')]);
    const card = $('gcsTaskCard');
    card.replaceChildren();
    for (const task of summary.tasks) {
      const li = document.createElement('li');
      li.dataset.ok = String(task.done);
      li.textContent = `${task.done ? '✔' : '○'} ${task.title}`;
      card.append(li);
    }
    if (summary.cohorts) {
      const select = $('gcsExportCohort');
      if (select.options.length !== summary.cohorts.length) {
        select.replaceChildren(...summary.cohorts.map((id) => new Option(id, id)));
      }
      select.hidden = summary.cohorts.length === 0;
      $('gcsExport').hidden = summary.cohorts.length === 0;
      $('gcsExport').disabled = summary.cohorts.length === 0;
    }
    const list = $('gcsBackupList');
    list.replaceChildren();
    if (!backupData.backups.length) {
      const li = document.createElement('li');
      li.textContent = '尚無備份。';
      list.append(li);
    }
    for (const item of backupData.backups.slice(0, 20)) {
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = `#${item.id} ${new Date(item.created_at).toLocaleString('zh-TW', { hour12: false })}`;
      const meta = document.createElement('span');
      const who = item.is_mine ? '我' : `${item.requester}${item.cohort ? `（${item.cohort}）` : ''}`;
      meta.textContent = ` ${who} · ${item.param_count} 個參數${item.missing_count ? `，缺少 ${item.missing_count}` : ''} · 教師覆核：${item.review_label}${item.review_note ? `（${item.review_note}）` : ''}`;
      li.dataset.status = item.review_status === 'PASS' ? 'APPLIED' : item.review_status === 'NG' ? 'FAILED' : '';
      li.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'gcs-actions';
      addButton(actions, '差異報告', () => showDiff(item));
      if (item.can_review) {
        addButton(actions, 'PASS', () => reviewItem(`/gcs/api/backups/${item.id}/review/`, 'PASS'));
        addButton(actions, 'NG', () => reviewItem(`/gcs/api/backups/${item.id}/review/`, 'NG'));
      }
      li.append(actions);
      list.append(li);
    }
  } catch (error) {
    /* 下次再試 */
  }
}
