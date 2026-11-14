// FDE-GCS P4／S6：多機 SITL 仿真與編隊。
// - 連線用 Django 簽發的短效票證（唯讀／教師控制），WebSocket 直連本機 SITL Gateway。
// - 所有數值都來自 Gateway 轉送的 SITL 遙測；斷線時清空，不保留舊值。
// - 本檔與真機 Web Serial（gcs.js）完全獨立，不共用連線物件或狀態。

const $ = (id) => document.getElementById(id);
const MODE_TEXT = { STABILIZE: '自穩', GUIDED: '引導', AUTO: '自動', RTL: '返航', LAND: '降落', BRAKE: '停住', LOITER: '定點' };

let ws = null;
let scope = null;
let renewTimer = null;

function csrf() {
  return document.body.dataset.csrf || '';
}

async function requestTicket(wanted) {
  const res = await fetch('api/sitl/ticket/', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
    body: JSON.stringify({ scope: wanted }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error === 'teacher_only' ? '只有教師能取得控制權' : `取得憑證失敗（${data.error || res.status}）`);
  return data;
}

function setMessage(text) {
  $('gcsSitlMessage').textContent = text;
}

function setLink(state, text) {
  const el = $('gcsSitlLink');
  el.dataset.state = state;
  el.textContent = text;
}

function cell(row, text) {
  const td = document.createElement('td');
  td.textContent = text;
  row.append(td);
}

function renderFleet(msg) {
  const body = $('gcsSitlFleet');
  body.replaceChildren();
  for (const v of msg.vehicles) {
    const tr = document.createElement('tr');
    tr.dataset.online = String(v.online);
    if (!v.online) {
      cell(tr, `機 ${v.id}`);
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = '未連線（等待 SITL）';
      tr.append(td);
    } else {
      cell(tr, `機 ${v.id}（系統 ${v.sysid}）`);
      cell(tr, `${MODE_TEXT[v.mode] || v.mode}`);
      cell(tr, v.armed ? '已解鎖' : '上鎖');
      cell(tr, `${v.alt_m.toFixed(1)} m`);
      cell(tr, `${v.speed_mps.toFixed(1)} m/s`);
      cell(tr, v.battery_pct == null ? '—' : `${v.battery_pct}%`);
      cell(tr, v.gps_fix >= 3 ? `3D・${v.sats}` : '未定位');
    }
    body.append(tr);
  }
  const job = msg.job || {};
  $('gcsSitlJob').textContent = job.text || '—';
  $('gcsSitlJob').dataset.ok = String(job.ok !== false);
  const errs = msg.formation_err_m || [];
  $('gcsSitlFormErr').textContent = msg.formation && errs.length
    ? errs.map((e, i) => `機 ${i + 2}：${e.toFixed(1)} m`).join('、')
    : '—';
}

function clearFleet(text) {
  $('gcsSitlFleet').replaceChildren();
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 7;
  td.textContent = text;
  tr.append(td);
  $('gcsSitlFleet').append(tr);
  $('gcsSitlJob').textContent = '—';
  $('gcsSitlFormErr').textContent = '—';
}

function setScope(next) {
  scope = next;
  $('gcsSitlScope').textContent = next === 'control' ? '控制權（10 分鐘內有效）' : next === 'read' ? '唯讀' : '—';
  const controls = $('gcsSitlControls');
  if (controls) controls.disabled = next !== 'control';
  const controlBtn = $('gcsSitlControl');
  if (controlBtn) controlBtn.disabled = !next;
}

async function connect(wanted) {
  if (ws) ws.close();
  clearTimeout(renewTimer);
  setLink('connecting', '連線中…');
  let t;
  try {
    t = await requestTicket(wanted);
  } catch (e) {
    setLink('disconnected', '未連線');
    setMessage(e.message);
    return;
  }
  const url = `${t.gateway_url}/?ticket=${encodeURIComponent(t.ticket)}`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    setLink('connected', '已連線');
    setScope(t.scope);
    setMessage(t.scope === 'control' ? '已取得控制權。所有指令只會送到本機 SITL。' : '已連線（唯讀）。');
    // 到期前 30 秒自動續票（控制權到期後改回唯讀，需要教師重新取得）
    const ms = Math.max(5_000, t.exp * 1000 - Date.now() - 30_000);
    renewTimer = setTimeout(() => connect('read'), ms);
  };
  sock.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'fleet') renderFleet(msg);
    if (msg.type === 'ack') setMessage(msg.ok ? `指令已送出：${msg.text}` : `指令被拒絕：${msg.error}`);
  };
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    ws = null;
    setScope(null);
    setLink('disconnected', '未連線');
    clearFleet('已斷線，沒有顯示舊資料。');
    setMessage(ev.code === 4003 ? '控制權已被教師撤銷。' : ev.code === 4001 ? '憑證已到期，請重新連線。' : '與 Gateway 的連線中斷（Gateway 是否已啟動？）。');
  };
}

function send(action) {
  if (!ws || scope !== 'control') return;
  const args = {
    alt: Number($('gcsSitlAlt').value),
    shape: $('gcsSitlShape').value,
    spacing: Number($('gcsSitlSpacing').value),
    heading: Number($('gcsSitlHeading').value),
    path: $('gcsSitlPath').value,
  };
  ws.send(JSON.stringify({ type: 'cmd', action, args }));
  setMessage('指令送出中…');
}

async function revoke() {
  const res = await fetch('api/sitl/revoke/', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
    body: JSON.stringify({ brake: true }),
  });
  setMessage(res.ok ? '已撤銷所有控制權，飛機已停在原地。' : '撤銷失敗：Gateway 沒有回應。');
}

document.addEventListener('DOMContentLoaded', () => {
  const section = $('gcs-sitl');
  if (!section || section.dataset.sitlEnabled !== '1') return;
  const scene = $('gcsSitlScene');
  if (scene && section.dataset.simUrl) scene.src = section.dataset.simUrl;
  $('gcsSitlConnect').addEventListener('click', () => connect('read'));
  $('gcsSitlControl')?.addEventListener('click', () => connect('control'));
  $('gcsSitlRevoke')?.addEventListener('click', revoke);
  document.querySelectorAll('[data-sitl-cmd]').forEach((b) => b.addEventListener('click', () => send(b.dataset.sitlCmd)));
});
