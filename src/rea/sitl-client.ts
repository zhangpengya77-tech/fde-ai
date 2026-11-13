/**
 * PHYSICS PRO 引擎（Tier 1）：透過本機 FDE-DT 服務（HTTP 8200／WS 8201）驅動 ArduPilot SITL。
 *
 * - 遙測（ENU）→ 考場座標：依「考生面向」旋轉（與 fde_twin/coords.py 的 enu_to_field 相同公式）。
 * - 定位模式 → ArduCopter LOITER；姿態模式 → ALT_HOLD（油門中立＝維持高度，語意與 WEB LITE 一致）。
 * - 標準化搖桿指令每 50 ms 送一次；停送 250 ms 由服務端解除 override、交給 SITL 失效保護。
 * - 只連 127.0.0.1，服務端另有 SITL 驗證與 CORS 白名單（見 03_SAFETY_AND_ISOLATION.md）。
 */

import { fieldOf, type Vec2 } from './courses';
import type { Command, DroneState } from './physics';
import { angleDiff, initialState } from './physics';
import { CourseRunner, type CourseResult } from './runner';
import type { Sample, SessionOptions } from './session';
import type { EngineLabels, FlightEngine } from './engine';
import { levelToSpeed } from './wind';

// The runner stops only the isolated Gazebo telemetry source after landing to
// verify UI freshness. This is deliberately independent of Gateway watchdogs.
const READ_ONLY_FRESHNESS_MS = 3_000;

export interface SitlConfig {
  /** 服務位址，預設 http://127.0.0.1:8200 */
  base: string;
  token: string;
  /** 考生面向的方位角（0 = 北，順時針） */
  facingDeg: number;
  /** 測試限定：附掛受控 Runner 已建立的 Session，僅可讀取遙測。 */
  attach?: ReadOnlySessionAttachment;
}

export interface ReadOnlySessionAttachment {
  sessionId: string;
  simulationInstanceId: string;
  systemId: number;
  componentId: number;
  /** Gateway 簽發的短效 telemetry:read ticket；不是管理 token。 */
  readTicket: string;
  expiresAt: number;
}

type ReadAttachmentStorage = Pick<Storage, 'getItem' | 'removeItem'>;
export const EXTERNAL_READ_ATTACHMENT_KEY = 'fde-rea-attach-v1';

/**
 * Test runners inject this once into sessionStorage.  It is deliberately not
 * persisted with normal preferences and is consumed before the engine starts.
 */
export function consumeExternalReadAttachment(storage: ReadAttachmentStorage): ReadOnlySessionAttachment | undefined {
  const raw = storage.getItem(EXTERNAL_READ_ATTACHMENT_KEY);
  storage.removeItem(EXTERNAL_READ_ATTACHMENT_KEY);
  if (!raw) return undefined;
  try {
    return parseReadAttachment(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** 續發 ticket 事件名稱（只在 attach 模式由受控測試觸發） */
export const READ_ATTACHMENT_RENEW_EVENT = 'fde-rea-attach-renew';

/** 驗證並取出唯讀附掛欄位（初次注入與續發共用同一套檢查） */
export function parseReadAttachment(parsed: unknown): ReadOnlySessionAttachment | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const v = parsed as Record<string, unknown>;
  if (typeof v.sessionId !== 'string' || typeof v.simulationInstanceId !== 'string'
    || typeof v.systemId !== 'number' || typeof v.componentId !== 'number'
    || typeof v.readTicket !== 'string' || typeof v.expiresAt !== 'number'
    || v.expiresAt <= Date.now()) return undefined;
  return {
    sessionId: v.sessionId, simulationInstanceId: v.simulationInstanceId,
    systemId: v.systemId, componentId: v.componentId,
    readTicket: v.readTicket, expiresAt: v.expiresAt,
  };
}

const FROM_DEG: Record<string, number> = {
  front: 0, 'front-right': 45, right: 90, 'back-right': 135, back: 180, 'back-left': 225, left: 270, 'front-left': 315,
};

interface Telemetry {
  type: string; state?: string; t_ms?: number;
  pos_m?: [number, number, number]; vel_mps?: [number, number, number];
  att_deg?: { roll: number; pitch: number }; heading_deg_cw_from_north?: number;
  armed?: boolean; mode?: string;
  gps?: { fix: number; sats: number };
  sensor_health?: { gyro?: boolean; accel?: boolean };
  mission_progress?: { current_seq?: number; last_reached_seq?: number };
  simulator_type?: string; physics_model_version?: string; firmware_version?: string;
  level?: string; text?: string;
  telemetry_v2?: {
    vehicle_id?: string; simulation_instance_id?: string;
    system_id?: number; component_id?: number; link_status?: string;
    /** Gateway source timestamp; unlike the WebSocket envelope time it must not advance on replay. */
    timestamp?: number;
    mission_progress?: { current_seq?: number; last_reached_seq?: number };
  };
}

/**
 * 外部 Gazebo/ArduPilot 剛冷啟動時，位置訊息可能先於 EKF/IMU 收斂。
 * 這是瀏覽器端「等待條件」，不是對飛控的安全檢查替代或放寬。
 */
const ARM_GPS_SETTLE_MS = 15_000;

/** ENU（東、北）→ 考場（右、前）。 */
export function enuToField(e: number, n: number, facingDeg: number): Vec2 {
  const t = (facingDeg * Math.PI) / 180;
  return { x: e * Math.cos(t) - n * Math.sin(t), y: e * Math.sin(t) + n * Math.cos(t) };
}

export class SitlEngine implements FlightEngine {
  labels: EngineLabels = {
    simulator_type: 'ardupilot_sitl', physics_model_version: '連線中', firmware_version: '連線中',
    display: 'PHYSICS PRO・ArduPilot SITL（連線中）',
  };
  readonly runner: CourseRunner;
  readonly samples: Sample[] = [];
  state: DroneState = initialState({ x: 0, y: 0 }, 0);
  t = 0;
  lastCmd: Command = { throttle: 0.5, pitch: 0, roll: 0, yaw: 0 };
  statusText = '連線本機 PHYSICS PRO 服務…';
  failed: string | null = null;
  /** Test-only read model: copied from the accepted Gateway telemetry before Three.js applies it. */
  observation?: { sessionId: string; simulationInstanceId: string; systemId: number; componentId: number;
    sampleId: number;
    sourceTimestamp: number; receivedTimestamp: number; positionEnu: [number, number, number];
    attitudeDeg: { roll: number; pitch: number; yaw: number }; mode: string; armed: boolean;
    missionProgress?: { current_seq?: number; last_reached_seq?: number } };

  private ws: WebSocket | null = null;
  private sessionId = '';
  private armedOnce = false;
  private modeSent = false;
  private lastArmTry = Number.NEGATIVE_INFINITY; // 第一次立刻嘗試解鎖（頁面剛開時 performance.now() 很小）
  private gpsReadyAt: number | null = null;
  private lastRcSent = Number.NEGATIVE_INFINITY;
  private t0: number | null = null;
  private lastT = 0;
  private headingCont: number | null = null;
  private disposed = false;
  private observationSequence = 0;
  /** Last authoritative Gateway source sample accepted by a read-only attach. */
  private lastAttachedSourceTimestamp: number | null = null;
  private readClosed = false;
  /** 目前生效的唯讀附掛（續發 ticket 後會換成新的；身分欄位永遠與初始相同） */
  private activeAttach: ReadOnlySessionAttachment | undefined;
  /** 續發中、尚未收到第一筆有效遙測的新連線 */
  private pendingWs: WebSocket | null = null;

  /** Read-only attach lifecycle for E2E evidence; it exposes no command surface. */
  get readOnlyLinkStatus(): 'live' | 'stale' | 'disconnected' | 'pending' {
    if (!this.attached) return 'pending';
    if (this.readClosed) return 'disconnected';
    if (this.observation && Date.now() - this.observation.receivedTimestamp >= READ_ONLY_FRESHNESS_MS) return 'stale';
    return this.failed ? 'stale' : this.observation ? 'live' : 'pending';
  }

  constructor(readonly opts: SessionOptions, private readonly cfg: SitlConfig) {
    this.activeAttach = cfg.attach;
    this.runner = new CourseRunner(opts.subject, fieldOf(opts.subject.field), opts);
    void this.connect();
  }

  get ready(): boolean { return this.armedOnce && !this.failed; }
  get done(): boolean { return this.runner.finished; }

  private headers(): Record<string, string> { return { 'X-FDE-DT-Token': this.cfg.token }; }
  private get attached(): boolean { return !!this.cfg.attach; }

  private attachWebSocketUrl(attach: ReadOnlySessionAttachment): string {
    const url = new URL(this.cfg.base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.port = '8201';
    url.pathname = `/session/${encodeURIComponent(attach.sessionId)}`;
    url.search = '';
    return url.toString();
  }

  private validAttachedTelemetry(d: Telemetry): boolean {
    const attach = this.cfg.attach;
    const v2 = d.telemetry_v2;
    return !!attach && !!v2 && v2.vehicle_id === attach.sessionId
      && v2.simulation_instance_id === attach.simulationInstanceId
      && v2.system_id === attach.systemId && v2.component_id === attach.componentId
      && v2.link_status === 'connected';
  }

  private async connect(): Promise<void> {
    const attach = this.cfg.attach;
    if (attach) {
      if (attach.expiresAt <= Date.now()) {
        this.failed = 'PHYSICS PRO 唯讀訂閱授權已過期';
        return;
      }
      if (this.disposed) return;
      this.sessionId = attach.sessionId;
      this.statusText = '訂閱受控 Mission Session 的唯讀遙測…';
      // Browser WebSocket cannot set arbitrary headers.  The ticket is sent
      // as a controlled subprotocol rather than a URL query, so it is absent
      // from navigation history, URLs, screenshots, and normal access logs.
      const ws = new WebSocket(this.attachWebSocketUrl(attach), ['fde-dt-read-v1', attach.readTicket]);
      this.ws = ws;
      this.bindReadSocket(ws);
      return;
    }
    let res: Response;
    try {
      res = await fetch(`${this.cfg.base}/api/v1/sessions`, { method: 'POST', headers: this.headers() });
    } catch {
      this.failed = '連不到本機 PHYSICS PRO 服務（127.0.0.1:8200）。請確認已在這台電腦啟動 FDE-DT 服務，或改回 WEB LITE。';
      return;
    }
    if (res.status === 401) { this.failed = 'PHYSICS PRO 金鑰不正確'; return; }
    if (res.status === 409) { this.failed = '這台電腦已經有一台 SITL 在飛（同時只允許一台）'; return; }
    if (res.status === 403) { this.failed = '這個網頁來源不在 PHYSICS PRO 服務的允許清單'; return; }
    if (!res.ok) { this.failed = `PHYSICS PRO 服務錯誤（${res.status}）`; return; }
    const info = await res.json();
    if (this.disposed) { void this.release(info.session_id); return; }
    this.sessionId = info.session_id;
    this.setLabels(info);
    this.statusText = 'SITL 啟動中：驗證對端、等待 GPS 與 EKF 就緒（約 30–60 秒）…';
    const ws = new WebSocket(`${info.ws_url}?token=${encodeURIComponent(this.cfg.token)}`);
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)) as Telemetry);
    ws.onclose = () => { if (!this.disposed && !this.done) this.failed = this.failed ?? '與 PHYSICS PRO 服務的連線中斷'; };
  }

  /** 唯讀連線事件：只處理「目前生效」那條連線，舊連線到期關閉或送出的錯誤一律忽略 */
  private bindReadSocket(ws: WebSocket): void {
    ws.onmessage = (ev) => {
      if (ws === this.pendingWs) this.promotePending(ws);
      if (ws !== this.ws) return;
      this.onMessage(JSON.parse(String(ev.data)) as Telemetry);
    };
    ws.onclose = () => {
      if (ws === this.pendingWs) { this.pendingWs = null; return; } // 續發失敗：保留舊連線
      if (ws !== this.ws) return; // 已被取代的舊連線
      this.readClosed = true;
      if (!this.disposed && !this.done) this.failed = this.failed ?? '受控 Mission Session 遙測已中斷或授權已失效';
    };
  }

  /** 新連線收到第一則訊息 → 正式切換，關閉舊連線 */
  private promotePending(ws: WebSocket): void {
    const old = this.ws;
    this.ws = ws;
    this.pendingWs = null;
    old?.close();
  }

  /**
   * 飛行中續發唯讀 ticket（由受控 Runner 透過測試注入）。
   * 只接受「同一 Session／模擬實例／SYSID／COMPID」且效期比現有更晚的 ticket；
   * 新連線收到資料後才切換，不會中斷觀察，也不提供任何控制能力。
   * 回傳 false 表示拒絕（身分不符、已過期、已中斷或非 attach 模式）。
   */
  renewReadAttachment(next: ReadOnlySessionAttachment): boolean {
    const cur = this.activeAttach;
    if (!cur || this.disposed || this.readClosed) return false;
    if (next.sessionId !== cur.sessionId || next.simulationInstanceId !== cur.simulationInstanceId
      || next.systemId !== cur.systemId || next.componentId !== cur.componentId) return false;
    if (next.expiresAt <= Date.now() || next.expiresAt <= cur.expiresAt || !next.readTicket) return false;
    this.pendingWs?.close();
    this.activeAttach = next;
    const ws = new WebSocket(this.attachWebSocketUrl(next), ['fde-dt-read-v1', next.readTicket]);
    this.pendingWs = ws;
    this.bindReadSocket(ws);
    return true;
  }

  private setLabels(d: { simulator_type?: string; physics_model_version?: string; firmware_version?: string }): void {
    if (!d.firmware_version) return;
    const gazebo = d.simulator_type === 'gazebo_ardupilot_sitl';
    const source = gazebo ? 'Gazebo + ArduPilot SITL' : 'ArduPilot SITL';
    this.labels = {
      simulator_type: d.simulator_type ?? 'ardupilot_sitl',
      physics_model_version: d.physics_model_version ?? 'unknown',
      firmware_version: d.firmware_version,
      display: `PHYSICS PRO・${source} ${d.firmware_version}（機型參數未校準）`,
    };
  }

  private send(obj: object): void {
    // Browser attach mode is defense in depth only; the Gateway independently
    // rejects these messages.  The client must never attempt to control an
    // externally owned Mission Session.
    if (this.attached) return;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ v: 1, ...obj }));
  }

  private onMessage(d: Telemetry): void {
    if (d.type === 'status') {
      if (d.level === 'error') this.failed = d.text ?? '服務錯誤';
      return;
    }
    if (d.type !== 'telemetry') return;
    if (this.attached && !this.validAttachedTelemetry(d)) {
      this.failed = '受控 Mission Session 身分不符、遙測過期或已失效';
      return;
    }
    if (d.state === 'failed') { this.failed = 'SITL 驗證或啟動失敗'; return; }
    if (d.state !== 'ready') return;
    this.setLabels(d);
    const now = performance.now();
    if (!this.attached && !this.modeSent) {
      // 風況與飛行模式（只送一次）
      const w = this.opts.wind;
      const fromWorld = (this.cfg.facingDeg + (FROM_DEG[w.from] ?? 0)) % 360;
      this.send({ type: 'cmd', name: 'set_wind', args: { speed: levelToSpeed(w.level), from_deg: fromWorld, turbulence: w.gust * 0.6 } });
      this.send({ type: 'cmd', name: 'set_mode', args: { mode: this.opts.mode === 'position' ? 'LOITER' : 'ALT_HOLD' } });
      this.modeSent = true;
    }
    if (!d.pos_m) { this.statusText = 'SITL 已連線，等待定位（EKF）收斂…'; return; }
    if (!this.armedOnce) {
      if (d.armed) { this.armedOnce = true; this.statusText = ''; }
      else {
        if (this.attached) {
          this.statusText = '已訂閱受控 Mission Session，等待 Runner 解鎖與起飛…';
          return;
        }
        if ((d.gps?.fix ?? 0) < 3) {
          this.gpsReadyAt = null;
          this.statusText = 'SITL 已連線，等待 GPS／EKF 定位收斂…';
          return;
        }
        if (d.sensor_health?.gyro !== true) {
          this.gpsReadyAt = null;
          this.statusText = 'SITL 已定位，等待飛控回報陀螺儀健康後再請求解鎖…';
          return;
        }
        if (this.gpsReadyAt === null) this.gpsReadyAt = now;
        const settleRemaining = ARM_GPS_SETTLE_MS - (now - this.gpsReadyAt);
        if (settleRemaining > 0) {
          this.statusText = 'GPS／EKF 已定位，正在等待 IMU 穩定後再請求解鎖…';
          return;
        }
        this.statusText = 'SITL 定位與穩定等待完成，正在請求解鎖…';
        if (now - this.lastArmTry > 2000) { this.lastArmTry = now; this.send({ type: 'cmd', name: 'arm' }); }
        return;
      }
    }
    const [e, n, u] = d.pos_m;
    const [ve, vn, vu] = d.vel_mps ?? [0, 0, 0];
    const p = enuToField(e, n, this.cfg.facingDeg);
    const v = enuToField(ve, vn, this.cfg.facingDeg);
    const raw = (d.heading_deg_cw_from_north ?? 0) - this.cfg.facingDeg;
    const v2 = d.telemetry_v2;
    // The Gateway may re-send its cached telemetry while Gazebo has stopped.
    // Only its source timestamp identifies a new authority sample; the WebSocket
    // envelope clock is transport activity and must never make stale data live.
    const sourceTimestamp = v2?.timestamp;
    if (this.attached && typeof sourceTimestamp === 'number') {
      // 只接受嚴格遞增的來源時間（續發換線重疊期間不得倒退或重複）
      if (this.lastAttachedSourceTimestamp !== null && sourceTimestamp <= this.lastAttachedSourceTimestamp) return;
      this.lastAttachedSourceTimestamp = sourceTimestamp;
    }
    if (this.attached && v2) this.observation = {
      sampleId: ++this.observationSequence, sessionId: v2.vehicle_id!, simulationInstanceId: v2.simulation_instance_id!, systemId: v2.system_id!, componentId: v2.component_id!,
      sourceTimestamp: sourceTimestamp ?? d.t_ms ?? Date.now(), receivedTimestamp: Date.now(), positionEnu: [e, n, u],
      attitudeDeg: { roll: d.att_deg?.roll ?? 0, pitch: d.att_deg?.pitch ?? 0, yaw: d.heading_deg_cw_from_north ?? 0 },
      mode: d.mode ?? '', armed: !!d.armed, missionProgress: d.mission_progress,
    };
    // 機頭角做連續化（避免 359°→0° 跳動影響回放內插）
    this.headingCont = this.headingCont === null ? raw : this.headingCont + angleDiff(raw, this.headingCont);
    const speed = Math.hypot(v.x, v.y);
    const armed = !!d.armed;
    const landed = !armed || (u < 0.15 && Math.abs(vu) < 0.3 && speed < 0.3);
    this.state = {
      x: p.x, y: p.y, h: Math.max(0, u), vx: v.x, vy: v.y, vh: vu, heading: this.headingCont,
      pitchDeg: d.att_deg?.pitch ?? 0, rollDeg: d.att_deg?.roll ?? 0,
      armed, landed, crashed: false, crashReason: '',
    };
    const tSim = d.t_ms ? (this.t0 === null ? ((this.t0 = d.t_ms), 0) : (d.t_ms - this.t0) / 1000) : this.t + 0.05;
    const dt = Math.max(0, tSim - this.lastT);
    this.lastT = tSim;
    this.t = tSim;
    const info = this.runner.update(this.t, this.state, dt);
    this.samples.push({
      t: this.t, x: p.x, y: p.y, h: this.state.h, heading: this.state.heading, pitchDeg: this.state.pitchDeg,
      rollDeg: this.state.rollDeg, cmd: { ...this.lastCmd }, stepIndex: info.stepIndex, cross: info.cross, headErr: info.headErr,
    });
  }

  advance(_dt: number, pilot: (e: FlightEngine) => Command): void {
    if (!this.ready) return;
    if (this.attached) return;
    const cmd = pilot(this);
    this.lastCmd = cmd;
    const now = performance.now();
    if (now - this.lastRcSent >= 50) {
      this.lastRcSent = now;
      this.send({ type: 'rc', t_ms: Date.now(), ch: { roll: cmd.roll, pitch: cmd.pitch, yaw: cmd.yaw, throttle: cmd.throttle } });
    }
  }

  /** 練習用故障注入（GPS 異常／恢復）。 */
  injectFault(fault: 'gps_loss' | 'gps_restore'): void {
    this.send({ type: 'cmd', name: 'inject_fault', args: { fault } });
  }

  windAt(): Vec2 {
    const w = this.opts.wind;
    const sp = levelToSpeed(w.level);
    const toRad = (((FROM_DEG[w.from] ?? 0) + 180) * Math.PI) / 180;
    return { x: sp * Math.sin(toRad), y: sp * Math.cos(toRad) };
  }

  result(): CourseResult { return this.runner.result(); }

  private async release(id: string): Promise<void> {
    if (!id) return;
    try {
      await fetch(`${this.cfg.base}/api/v1/sessions/${id}`, { method: 'DELETE', headers: this.headers(), keepalive: true });
    } catch { /* 服務已關閉也沒關係：服務端有斷線逾時自動結束 */ }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observation = undefined;
    this.observationSequence = 0;
    this.lastAttachedSourceTimestamp = null;
    this.readClosed = true;
    if (!this.attached) this.send({ type: 'cmd', name: 'disarm' });
    this.ws?.close();
    this.pendingWs?.close();
    if (!this.attached) void this.release(this.sessionId);
  }
}
