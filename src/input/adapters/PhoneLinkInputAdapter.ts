import { VirtualStickAdapter } from './VirtualStickAdapter';
import { ICE_SERVERS, apiBase, isStickMessage, phoneUrl, postJson, waitIceComplete } from '../phone/simlink-client';

/**
 * 手機當遙控器（筆電端）2026-11-07
 *
 * 1. connect()：建立 WebRTC 連線邀請 → 上傳取得 6 碼配對碼 → 畫面顯示 QR 碼
 * 2. 每 1.5 秒詢問手機是否已回應；回應後雙方直接連線
 * 3. 手機每秒送約 30 次搖桿數值；超過 0.25 秒沒收到 → 自動懸停（既有斷訊保護）
 * 配對碼 3 分鐘內有效，逾時請按「重新產生」。
 */
export type PhoneStatus = 'off' | 'creating' | 'waiting' | 'connecting' | 'connected' | 'lost' | 'error';

export interface PhoneState {
  status: PhoneStatus;
  code: string | null;
  url: string | null;
  message: string;
}

export class PhoneLinkInputAdapter extends VirtualStickAdapter {
  readonly id = 'phone-link';
  readonly type = 'phone-link' as const;
  readonly label = '手機遙控器';

  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private pollTimer = 0;
  private status: PhoneStatus = 'off';
  private code: string | null = null;
  private lastSeq = -1;

  constructor(private readonly onState?: (state: PhoneState) => void) {
    super();
  }

  state(): PhoneState {
    return { status: this.status, code: this.code, url: this.code ? phoneUrl(this.code) : null, message: this.error ?? '' };
  }

  async connect(): Promise<void> {
    this.disconnect();
    if (typeof RTCPeerConnection === 'undefined') return this.fail('這個瀏覽器不支援 WebRTC，請改用 Chrome／Edge。');
    this.set('creating');
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    // 不保證送達順序與重送：搖桿只要最新值，舊封包丟掉比延遲更好
    const channel = pc.createDataChannel('sticks', { ordered: false, maxRetransmits: 0 });
    this.channel = channel;
    channel.onopen = () => this.set('connected');
    channel.onclose = () => {
      this.active = false;
      if (this.status !== 'off') this.set('lost', '手機已斷線，請重新配對。');
    };
    channel.onmessage = (ev) => this.onMessage(ev.data);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fail('連不上手機：請確認手機和筆電在同一個 Wi‑Fi（或用手機熱點）。');
    };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitIceComplete(pc);
      const res = await postJson(`${apiBase()}/rooms`, { offer: pc.localDescription });
      if (!res.ok) throw new Error(`配對服務回應 ${res.status}`);
      this.code = ((await res.json()) as { code: string }).code;
    } catch {
      return this.fail('無法建立配對碼：教學主機可能離線，或網路暫時有問題。');
    }
    this.set('waiting');
    const started = Date.now();
    const code = this.code;
    const poll = async (): Promise<void> => {
      if (this.pc !== pc || this.status !== 'waiting') return;
      if (Date.now() - started > 175_000) return this.fail('配對碼已過期，請按「重新產生」。');
      try {
        const r = await fetch(`${apiBase()}/rooms/${code}/answer`, { credentials: 'omit', cache: 'no-store' });
        if (r.status === 200) {
          const { answer } = (await r.json()) as { answer: RTCSessionDescriptionInit };
          this.set('connecting');
          await pc.setRemoteDescription(answer);
          return;
        }
        if (r.status === 404) return this.fail('配對碼已過期，請按「重新產生」。');
      } catch {
        /* 網路短暫失敗：下次再問 */
      }
      this.pollTimer = window.setTimeout(poll, 1500);
    };
    this.pollTimer = window.setTimeout(poll, 1500);
  }

  disconnect(): void {
    clearTimeout(this.pollTimer);
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pc = null;
    this.code = null;
    this.active = false;
    this.lastSeq = -1;
    if (this.status !== 'off') this.set('off');
  }

  private onMessage(data: unknown): void {
    if (typeof data !== 'string' || data.length > 512) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!isStickMessage(msg) || msg.n <= this.lastSeq) return;
    this.lastSeq = msg.n;
    this.active = true;
    this.push({ roll: msg.roll, pitch: msg.pitch, yaw: msg.yaw, throttle: msg.throttle }, performance.now());
  }

  private set(status: PhoneStatus, message = ''): void {
    this.status = status;
    this.error = message || null;
    this.onState?.(this.state());
  }

  private fail(message: string): void {
    clearTimeout(this.pollTimer);
    this.active = false;
    this.set('error', message);
  }
}
