// FDE-GCS Web 1.0 介面（P2：真機 USB 唯讀）。不送出任何寫入或控制訊息；送出白名單在 mavlink/codec.js。
import { VehicleLink } from './mavlink/link.js';

const MODE_TEXT = {
  demo: ['DEMO 介面', '目前未連線任何飛控。畫面上沒有真實遙測，也沒有用假資料冒充遙測。'],
  real: ['真機模式（未連線）', '按「選擇 USB 並連線」，在瀏覽器視窗中手動選擇飛控的 COM 埠。本階段只讀取，不會寫入飛控。'],
  realConnected: ['真機模式（已連線・唯讀）', '資料來自 USB 連線的飛控。本階段不提供解鎖、切換模式、起飛或寫入參數。'],
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
    td.colSpan = 4;
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
  }
  if (rows.length > 500) {
    const td = body.insertRow().insertCell();
    td.colSpan = 4;
    td.textContent = `只顯示前 500 筆，共 ${rows.length} 筆；請用搜尋縮小範圍。`;
  }
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
  setInterval(() => link && render(), 500);
  render();
});
