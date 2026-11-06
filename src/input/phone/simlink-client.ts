/**
 * 手機遙控器配對：WebRTC 共用工具（筆電端與手機端都用）2026-11-07
 *
 * 流程：筆電建立 offer → 上傳到 /api/simlink 取得 6 碼配對碼 → 手機掃 QR 碼取得 offer
 *       → 手機送回 answer → 筆電收到後雙方「點對點」直連（DataChannel，不經伺服器）。
 * 連線描述一次送完整（等候位址收集完成），伺服器只需轉交兩次，請求數很少。
 * 手機與筆電需在同一個 Wi‑Fi（或手機開熱點給筆電）才能直連。
 */

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

/** 配對服務的網址前綴：模擬器掛在 /sim/app/ 底下時，API 在同一網域的 /api/simlink */
export function apiBase(): string {
  const override = (window as unknown as { __fdeSimlinkBase?: string }).__fdeSimlinkBase;
  return (override ?? `${location.origin}/api/simlink`).replace(/\/+$/, '');
}

/** 等候位址（ICE candidate）收集完成，最多 4 秒；完成後 localDescription 才包含所有位址 */
export function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
  });
}

/** 手機送出的搖桿訊息（JSON，每秒約 30 次） */
export interface PhoneStickMessage {
  t: 'sticks';
  /** 手機端序號，用來丟棄亂序封包 */
  n: number;
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

export function isStickMessage(v: unknown): v is PhoneStickMessage {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    m.t === 'sticks' &&
    typeof m.n === 'number' &&
    ['roll', 'pitch', 'yaw', 'throttle'].every((k) => typeof m[k] === 'number' && Number.isFinite(m[k] as number))
  );
}

/** 手機端網址：與模擬器同一資料夾的 phone.html，帶上配對碼 */
export function phoneUrl(code: string): string {
  const here = new URL('./phone.html', location.href);
  here.search = `?code=${encodeURIComponent(code)}`;
  here.hash = '';
  return here.toString();
}
