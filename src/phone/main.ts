/**
 * 手機遙控器頁（手機端）2026-11-07
 *
 * 用法：在模擬器按「手機遙控器」→ 手機相機掃 QR 碼 → 開啟本頁自動配對。
 * 配對成功後橫放手機，用兩個拇指操作（美國手 Mode 2）：
 *   左搖桿：上下＝上升／下降（放開＝保持高度）、左右＝左轉／右轉
 *   右搖桿：上下＝前進／後退、左右＝左移／右移
 * 搖桿數值每秒送 30 次，直接傳到筆電（點對點），不經過伺服器。
 */
import { ICE_SERVERS, apiBase, postJson, waitIceComplete, type PhoneStickMessage } from '../input/phone/simlink-client';
import { sticksToCommand, touchToStick, type StickXY } from './stick-math';

const root = document.getElementById('phone')!;
root.innerHTML = `
<style>
  html,body{margin:0;height:100%;background:#06111f;color:#e6f6ff;font-family:system-ui,"PingFang TC","Microsoft JhengHei",sans-serif;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}
  #phone{position:fixed;inset:0;display:flex;flex-direction:column}
  .bar{display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:14px;background:#0b1b2e;border-bottom:1px solid #1fb8ff33}
  .dot{width:10px;height:10px;border-radius:50%;background:#888}
  .bar[data-s="connected"] .dot{background:#2ee59d;box-shadow:0 0 10px #2ee59d}
  .bar[data-s="error"] .dot{background:#ff5d5d}
  .pads{flex:1;display:flex}
  .pad{flex:1;position:relative;display:grid;place-items:center}
  .ring{width:min(42vw,42vh,240px);aspect-ratio:1;border-radius:50%;border:2px solid #1fb8ff66;background:radial-gradient(circle,#0e2a44 0%,#081626 70%);position:relative}
  .knob{position:absolute;left:50%;top:50%;width:34%;aspect-ratio:1;margin:-17% 0 0 -17%;border-radius:50%;background:radial-gradient(circle at 35% 30%,#5fd4ff,#0a7bc0);box-shadow:0 0 18px #1fb8ff88}
  .cap{position:absolute;bottom:10px;left:0;right:0;text-align:center;font-size:12px;color:#8fb4cc}
  .rotate{display:none;position:fixed;inset:0;background:#06111fee;place-items:center;text-align:center;font-size:18px;padding:24px}
  @media (orientation:portrait){.rotate{display:grid}}
</style>
<div class="bar" data-s="connecting"><span class="dot"></span><b data-msg>正在配對…</b></div>
<div class="pads">
  <div class="pad" data-pad="left"><div class="ring"><div class="knob"></div></div><div class="cap">左：上升／下降・左轉／右轉</div></div>
  <div class="pad" data-pad="right"><div class="ring"><div class="knob"></div></div><div class="cap">右：前進／後退・左移／右移</div></div>
</div>
<div class="rotate">請把手機<b>橫放</b>，用兩個拇指操作 📱↔️</div>`;

const bar = root.querySelector<HTMLElement>('.bar')!;
const msg = root.querySelector<HTMLElement>('[data-msg]')!;
const status = (s: string, text: string): void => {
  bar.dataset.s = s;
  msg.textContent = text;
};

// ── 兩支觸控搖桿（支援多指：每支搖桿記住自己的手指編號）──
const sticks: Record<'left' | 'right', StickXY> = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
for (const side of ['left', 'right'] as const) {
  const pad = root.querySelector<HTMLElement>(`[data-pad="${side}"]`)!;
  const ring = pad.querySelector<HTMLElement>('.ring')!;
  const knob = pad.querySelector<HTMLElement>('.knob')!;
  let pointer: number | null = null;
  const update = (ev: PointerEvent): void => {
    const r = ring.getBoundingClientRect();
    const radius = r.width / 2;
    const s = touchToStick(ev.clientX - (r.left + radius), ev.clientY - (r.top + radius), radius * 0.8);
    sticks[side] = s;
    knob.style.transform = `translate(${s.x * radius * 0.8}px, ${-s.y * radius * 0.8}px)`;
  };
  const release = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointer) return;
    pointer = null;
    sticks[side] = { x: 0, y: 0 }; // 放開＝回中（油門回中＝保持高度）
    knob.style.transform = '';
  };
  pad.addEventListener('pointerdown', (ev) => {
    if (pointer !== null) return;
    pointer = ev.pointerId;
    try {
      pad.setPointerCapture(ev.pointerId); // 手指滑出圓框仍持續追蹤
    } catch {
      /* 少數瀏覽器不支援時略過 */
    }
    update(ev);
  });
  pad.addEventListener('pointermove', (ev) => {
    if (ev.pointerId === pointer) update(ev);
  });
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
}

// ── 配對 ──
async function pair(): Promise<void> {
  const code = new URLSearchParams(location.search).get('code')?.trim();
  if (!code) return status('error', '缺少配對碼：請用手機相機掃模擬器上的 QR 碼。');
  let offer: RTCSessionDescriptionInit;
  try {
    const r = await fetch(`${apiBase()}/rooms/${encodeURIComponent(code)}/offer`, { credentials: 'omit', cache: 'no-store' });
    if (r.status === 404) return status('error', '配對碼已過期，請在模擬器按「重新產生」後再掃一次。');
    if (r.status === 409) return status('error', '這個配對碼已被其他手機使用。');
    if (!r.ok) throw new Error(String(r.status));
    offer = ((await r.json()) as { offer: RTCSessionDescriptionInit }).offer;
  } catch {
    return status('error', '連不到配對服務：教學主機可能離線。');
  }
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.ondatachannel = (ev) => start(ev.channel);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') status('error', '連不上筆電：請確認手機和筆電連同一個 Wi‑Fi（或用手機熱點）。');
    if (pc.connectionState === 'disconnected') status('error', '連線中斷，請在模擬器重新配對。');
  };
  await pc.setRemoteDescription(offer);
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIceComplete(pc);
  const res = await postJson(`${apiBase()}/rooms/${encodeURIComponent(code)}/answer`, { answer: pc.localDescription });
  if (!res.ok) return status('error', res.status === 409 ? '這個配對碼已被其他手機使用。' : '配對失敗，請重新掃碼。');
  status('connecting', '已送出配對，等待筆電連線…');
}

function start(channel: RTCDataChannel): void {
  let n = 0;
  let timer = 0;
  channel.onopen = () => {
    status('connected', '已連線：橫放手機，用兩個拇指飛行');
    // 嘗試讓螢幕保持常亮（不支援的瀏覽器就略過）
    (navigator as Navigator & { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request('screen').catch(() => undefined);
    timer = window.setInterval(() => {
      if (channel.readyState !== 'open') return;
      const m: PhoneStickMessage = { t: 'sticks', n: n++, ...sticksToCommand(sticks.left, sticks.right) };
      channel.send(JSON.stringify(m));
    }, 33);
  };
  channel.onclose = () => {
    clearInterval(timer);
    status('error', '連線已關閉，請在模擬器重新配對。');
  };
}

void pair();
