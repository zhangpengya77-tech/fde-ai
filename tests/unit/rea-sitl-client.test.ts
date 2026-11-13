// PHYSICS PRO 引擎（SitlEngine）單元測試：以假 fetch／WebSocket 模擬本機 FDE-DT 服務
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SitlEngine, consumeExternalReadAttachment, enuToField } from '../../src/rea/sitl-client';
import { FlightSession } from '../../src/rea/session';
import { WEB_LITE_LABELS } from '../../src/rea/engine';
import { subjectById } from '../../src/rea/courses';
import { DEFAULT_WIND } from '../../src/rea/wind';

class FakeWS {
  static last: FakeWS | null = null;
  static OPEN = 1;
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string, public protocols?: string | string[]) { FakeWS.last = this; }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; }
  push(obj: object) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

const opts = () => ({ subject: subjectById('hover-small')!, airframeId: 'quad-800g' as const, mode: 'position' as const, wind: { ...DEFAULT_WIND } });
const flush = () => new Promise((r) => setTimeout(r, 0));
const tele = (extra: object) => ({ v: 1, type: 'telemetry', frame: 'ENU', state: 'ready', firmware_version: 'ArduCopter Copter-4.7.2 (fb77356789)', physics_model_version: 'sitl-builtin-quad-default', sensor_health: { gyro: true, accel: true }, ...extra });

describe('PHYSICS PRO 座標與標示', () => {
  it('ENU → 考場座標與 Python enu_to_field 同公式', () => {
    const north = enuToField(2, 7, 0);
    expect(north.x).toBeCloseTo(2);
    expect(north.y).toBeCloseTo(7);
    const east = enuToField(5, 0, 90); // 面向東：往東 5 m ＝ 前方 5 m
    expect(east.x).toBeCloseTo(0);
    expect(east.y).toBeCloseTo(5);
    expect(enuToField(0, 3, 90).x).toBeCloseTo(-3); // 往北 3 m ＝ 左方 3 m
  });
  it('WEB LITE 標示不得宣稱高精度', () => {
    const s = new FlightSession(opts());
    expect(s.labels).toEqual(WEB_LITE_LABELS);
    expect(s.labels.display).toContain('非高精度');
    expect(s.ready).toBe(true);
  });
  it('一次性外部唯讀訂閱注入需具備完整身分與短效 ticket，讀取後立即移除', () => {
    const entries = new Map<string, string>();
    entries.set('fde-rea-attach-v1', JSON.stringify({
      sessionId: 's', simulationInstanceId: 'sim', systemId: 251, componentId: 1,
      readTicket: 'ticket', expiresAt: Date.now() + 10_000,
    }));
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      removeItem: (key: string) => entries.delete(key),
    };
    expect(consumeExternalReadAttachment(storage)).toMatchObject({ sessionId: 's', systemId: 251 });
    expect(entries.has('fde-rea-attach-v1')).toBe(false);
    expect(consumeExternalReadAttachment(storage)).toBeUndefined();
  });
});

describe('P5-J3 唯讀觀測', () => {
  it('attach 唯讀遙測超過三秒未更新時標記 stale，且不關閉 Session', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.stubGlobal('WebSocket', FakeWS);
    FakeWS.last = null;
    const e = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: '', facingDeg: 0, attach: {
      sessionId: 's', simulationInstanceId: 'sim', systemId: 251, componentId: 1, readTicket: 't', expiresAt: Date.now() + 60_000,
    }});
    await Promise.resolve();
    FakeWS.last!.push(tele({ t_ms: 1_000, armed: true, pos_m: [0, 0, 1], telemetry_v2: {
      vehicle_id: 's', simulation_instance_id: 'sim', system_id: 251, component_id: 1, timestamp: 1_000, link_status: 'connected',
    }}));
    expect(e.readOnlyLinkStatus).toBe('live');
    now.mockReturnValue(2_000);
    FakeWS.last!.push(tele({ t_ms: 2_000, armed: true, pos_m: [0, 0, 1], telemetry_v2: {
      vehicle_id: 's', simulation_instance_id: 'sim', system_id: 251, component_id: 1, timestamp: 1_000, link_status: 'connected',
    }}));
    now.mockReturnValue(4_001);
    expect(e.readOnlyLinkStatus).toBe('stale');
    expect(FakeWS.last!.sent).toEqual([]);
    e.dispose();
    now.mockRestore();
  });

  it('attach 引擎保留權威遙測身分、位置、姿態與任務進度供渲染驗證', async () => {
    vi.stubGlobal('WebSocket', FakeWS);
    FakeWS.last = null;
    const e = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: '', facingDeg: 0, attach: {
      sessionId: 's', simulationInstanceId: 'sim', systemId: 251, componentId: 1, readTicket: 't', expiresAt: Date.now() + 60_000,
    }});
    await flush();
    FakeWS.last!.push(tele({ t_ms: 1234, armed: true, mode: 'AUTO', pos_m: [2, 3, 4], att_deg: { roll: 5, pitch: 6 },
      heading_deg_cw_from_north: 7, mission_progress: { current_seq: 3, last_reached_seq: 2 },
      telemetry_v2: { vehicle_id: 's', simulation_instance_id: 'sim', system_id: 251, component_id: 1, link_status: 'connected' },
    }));
    expect(e.observation).toMatchObject({ sampleId: 1, sessionId: 's', simulationInstanceId: 'sim', positionEnu: [2, 3, 4], mode: 'AUTO', armed: true,
      missionProgress: { current_seq: 3, last_reached_seq: 2 } });
    FakeWS.last!.push(tele({ t_ms: 1235, armed: true, mode: 'AUTO', pos_m: [2, 3, 5],
      telemetry_v2: { vehicle_id: 's', simulation_instance_id: 'sim', system_id: 251, component_id: 1, link_status: 'connected' },
    }));
    expect(e.observation?.sampleId).toBe(2);
    e.dispose();
    expect(e.observation).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('SitlEngine 流程', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWS);
    FakeWS.last = null;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('建立 session → 準備中 → 送模式與風 → 解鎖 → 遙測驅動評分器 → 結束時釋放', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const calls: { url: string; method: string; token: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', token: (init.headers as Record<string, string>)['X-FDE-DT-Token'] });
      return new Response(JSON.stringify({ session_id: 'S1', ws_url: 'ws://127.0.0.1:8201/session/S1', firmware_version: 'ArduCopter Copter-4.7.2 (fb77356789)', physics_model_version: 'sitl-builtin-quad-default' }), { status: 201 });
    }));
    const e = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: 'k', facingDeg: 0 });
    await flush();
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:8200/api/v1/sessions', method: 'POST', token: 'k' });
    const ws = FakeWS.last!;
    expect(ws.url).toBe('ws://127.0.0.1:8201/session/S1?token=k');
    expect(e.ready).toBe(false);
    expect(e.labels.display).toContain('Copter-4.7.2');
    expect(e.labels.display).toContain('未校準');

    ws.push(tele({ t_ms: 1000, armed: false })); // 還沒有定位
    expect(ws.sent.map((m) => m.name)).toEqual(['set_wind', 'set_mode']);
    expect(ws.sent[1]).toMatchObject({ args: { mode: 'LOITER' } }); // 定位模式 → LOITER
    ws.push(tele({ t_ms: 1100, armed: false, pos_m: [0, 0, 0], gps: { fix: 6, sats: 10 } }));
    expect(ws.sent.some((m) => m.name === 'arm')).toBe(false);
    now += 15_001;
    ws.push(tele({ t_ms: 1150, armed: false, pos_m: [0, 0, 0], gps: { fix: 6, sats: 10 } }));
    expect(ws.sent.some((m) => m.name === 'arm')).toBe(true);
    expect(e.ready).toBe(false);

    ws.push(tele({ t_ms: 1200, armed: true, pos_m: [0, 0, 0], vel_mps: [0, 0, 0], heading_deg_cw_from_north: 0 }));
    expect(e.ready).toBe(true);
    // 起飛到 1.5 m 並穩定 → 評分器完成「起飛」步驟
    let t = 1300;
    for (let h = 0.2; h <= 1.6; h += 0.2) ws.push(tele({ t_ms: (t += 100), armed: true, pos_m: [0, 0, h], vel_mps: [0, 0, 0.5], heading_deg_cw_from_north: 0 }));
    ws.push(tele({ t_ms: (t += 100), armed: true, pos_m: [0, 0, 1.5], vel_mps: [0, 0, 0], heading_deg_cw_from_north: 0 }));
    expect(e.runner.results[0]?.label).toContain('起飛');
    expect(e.samples.length).toBeGreaterThan(5);
    expect(e.state.h).toBeCloseTo(1.5);

    // 搖桿指令送出（每 50 ms 節流）
    e.advance(0.016, () => ({ throttle: 0.7, pitch: 0.2, roll: 0, yaw: 0 }));
    expect(ws.sent.filter((m) => m.type === 'rc').length).toBe(1);

    e.dispose();
    await flush();
    expect(ws.sent.some((m) => m.name === 'disarm')).toBe(true);
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/api/v1/sessions/S1'))).toBe(true);
  });

  it('姿態模式 → ALT_HOLD；考生面向東時機頭角換算', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ session_id: 'S2', ws_url: 'ws://127.0.0.1:8201/session/S2', firmware_version: 'x' }), { status: 201 })));
    const e = new SitlEngine({ ...opts(), mode: 'attitude' }, { base: 'http://127.0.0.1:8200', token: 'k', facingDeg: 90 });
    await flush();
    const ws = FakeWS.last!;
    ws.push(tele({ t_ms: 1, armed: true, pos_m: [3, 0, 1], heading_deg_cw_from_north: 90 }));
    expect(ws.sent.find((m) => m.name === 'set_mode')).toMatchObject({ args: { mode: 'ALT_HOLD' } });
    expect(e.state.y).toBeCloseTo(3);          // 往東 3 m ＝ 考場前方 3 m
    expect(e.state.heading).toBeCloseTo(0);   // 機頭朝東 ＝ 朝外
  });

  it.each([
    [401, '金鑰不正確'],
    [409, '同時只允許一台'],
    [403, '允許清單'],
  ])('服務回 %s 時給出明確原因', async (status, text) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    const e = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: 'k', facingDeg: 0 });
    await flush();
    expect(e.failed).toContain(text);
    expect(e.ready).toBe(false);
  });

  it('連不到服務時提示改回 WEB LITE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const e = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: 'k', facingDeg: 0 });
    await flush();
    expect(e.failed).toContain('WEB LITE');
  });

  it('有效 GPS／定位遙測必須經過穩定等待窗才允許自動請求解鎖', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      session_id: 'S-gps', ws_url: 'ws://127.0.0.1:8201/session/S-gps', firmware_version: 'x',
    }), { status: 201 })));
    const e = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: 'k', facingDeg: 0 });
    await flush();
    const ws = FakeWS.last!;

    ws.push(tele({ t_ms: 1, armed: false, pos_m: [0, 0, 0], gps: { fix: 6, sats: 10 } }));
    expect(ws.sent.some((m) => m.name === 'arm')).toBe(false);

    now += 15_001;
    ws.push(tele({ t_ms: 2, armed: false, pos_m: [0, 0, 0], gps: { fix: 6, sats: 10 } }));
    expect(ws.sent.some((m) => m.name === 'arm')).toBe(true);
    e.dispose();
  });

  it('GPS 已定位但 SITL 回報陀螺儀未健康時不得自動請求解鎖', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      session_id: 'S-gyro', ws_url: 'ws://127.0.0.1:8201/session/S-gyro', firmware_version: 'x',
    }), { status: 201 })));
    const engine = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: 'k', facingDeg: 0 });
    await flush();
    const ws = FakeWS.last!;
    ws.push(tele({ armed: false, pos_m: [0, 0, 0], gps: { fix: 6, sats: 10 }, sensor_health: { gyro: false, accel: true } }));
    clock = 16_000;
    ws.push(tele({ armed: false, pos_m: [0, 0, 0], gps: { fix: 6, sats: 10 }, sensor_health: { gyro: false, accel: true } }));
    expect(ws.sent.some((m) => m.name === 'arm')).toBe(false);
    expect(engine.statusText).toContain('陀螺儀');
  });

  it('attach external session 只訂閱，不建立、不控制也不刪除外部 Session', async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET' });
      return new Response('{}', { status: 500 });
    }));
    const e = new SitlEngine(opts(), {
      base: 'http://127.0.0.1:8200', token: 'management-token-must-not-be-used', facingDeg: 0,
      attach: {
        sessionId: 'mission-session', simulationInstanceId: 'sim-mission',
        systemId: 251, componentId: 1, readTicket: 'short-lived-read-ticket', expiresAt: Date.now() + 60_000,
      },
    } as any);
    await flush();

    expect(calls).toEqual([]);
    const ws = FakeWS.last!;
    expect(ws.url).toBe('ws://127.0.0.1:8201/session/mission-session');
    expect(ws.protocols).toEqual(['fde-dt-read-v1', 'short-lived-read-ticket']);
    ws.push(tele({
      t_ms: 1, armed: true, pos_m: [0, 0, 1], vel_mps: [0, 0, 0], heading_deg_cw_from_north: 0,
      telemetry_v2: { vehicle_id: 'mission-session', simulation_instance_id: 'sim-mission', system_id: 251, component_id: 1, link_status: 'connected' },
    }));
    expect(ws.sent).toEqual([]);
    e.advance(0.1, () => ({ throttle: 0.6, pitch: 0.1, roll: 0, yaw: 0 }));
    expect(ws.sent).toEqual([]);
    e.dispose();
    await flush();
    expect(calls).toEqual([]);
  });

  it('attach external session 拒絕跨 Session 或過期 telemetry_v2', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const e = new SitlEngine(opts(), {
      base: 'http://127.0.0.1:8200', token: '', facingDeg: 0,
      attach: {
        sessionId: 'expected', simulationInstanceId: 'sim-expected', systemId: 251, componentId: 1,
        readTicket: 'short-ticket', expiresAt: Date.now() + 60_000,
      },
    } as any);
    await flush();
    FakeWS.last!.push(tele({
      armed: true, pos_m: [0, 0, 1],
      telemetry_v2: { vehicle_id: 'old-session', simulation_instance_id: 'sim-expected', system_id: 251, component_id: 1, link_status: 'connected' },
    }));
    expect(e.failed).toContain('身分不符');
    expect(e.ready).toBe(false);
  });
});

describe('唯讀 ticket 飛行中續發', () => {
  const v2 = (ts: number) => ({ vehicle_id: 's', simulation_instance_id: 'sim', system_id: 251, component_id: 1, timestamp: ts, link_status: 'connected' });
  const base = { sessionId: 's', simulationInstanceId: 'sim', systemId: 251, componentId: 1 };
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('新連線收到資料後才切換；舊連線到期關閉與錯誤訊息不影響；不送任何指令', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.stubGlobal('WebSocket', FakeWS);
    const e = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: '', facingDeg: 0, attach: { ...base, readTicket: 't1', expiresAt: 121_000 } });
    await Promise.resolve();
    const oldWs = FakeWS.last!;
    oldWs.push(tele({ armed: true, pos_m: [0, 0, 1], telemetry_v2: v2(1_000) }));
    expect(e.renewReadAttachment({ ...base, readTicket: 't2', expiresAt: 181_000 })).toBe(true);
    const newWs = FakeWS.last!;
    expect(newWs).not.toBe(oldWs);
    expect(newWs.protocols).toEqual(['fde-dt-read-v1', 't2']);
    // 切換前舊連線仍是主連線
    oldWs.push(tele({ armed: true, pos_m: [0, 0, 2], telemetry_v2: v2(1_100) }));
    expect(e.observation?.positionEnu[2]).toBe(2);
    newWs.push(tele({ armed: true, pos_m: [0, 0, 3], telemetry_v2: v2(1_200) }));
    expect(e.observation?.positionEnu[2]).toBe(3);
    expect(oldWs.readyState).toBe(3); // 舊連線已關閉
    // 舊連線之後的到期錯誤與關閉事件都被忽略
    oldWs.push({ v: 1, type: 'status', level: 'error', text: 'read-only ticket expired' });
    oldWs.onclose?.();
    expect(e.failed).toBeNull();
    expect(e.readOnlyLinkStatus).toBe('live');
    expect(oldWs.sent).toEqual([]);
    expect(newWs.sent).toEqual([]);
    e.dispose();
  });

  it('拒絕身分不符、效期沒有更晚、已過期的 ticket', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.stubGlobal('WebSocket', FakeWS);
    const e = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: '', facingDeg: 0, attach: { ...base, readTicket: 't1', expiresAt: 121_000 } });
    await Promise.resolve();
    const first = FakeWS.last;
    expect(e.renewReadAttachment({ ...base, systemId: 1, readTicket: 'x', expiresAt: 200_000 })).toBe(false);
    expect(e.renewReadAttachment({ ...base, sessionId: 'other', readTicket: 'x', expiresAt: 200_000 })).toBe(false);
    expect(e.renewReadAttachment({ ...base, readTicket: 'x', expiresAt: 121_000 })).toBe(false);
    expect(e.renewReadAttachment({ ...base, readTicket: 'x', expiresAt: 500 })).toBe(false);
    expect(FakeWS.last).toBe(first); // 沒有開新連線
    e.dispose();
  });

  it('續發連線失敗時保留舊連線；來源時間倒退的樣本不接受', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.stubGlobal('WebSocket', FakeWS);
    const e = new SitlEngine(opts(), { base: 'http://127.0.0.1:8200', token: '', facingDeg: 0, attach: { ...base, readTicket: 't1', expiresAt: 121_000 } });
    await Promise.resolve();
    const oldWs = FakeWS.last!;
    oldWs.push(tele({ armed: true, pos_m: [0, 0, 1], telemetry_v2: v2(2_000) }));
    e.renewReadAttachment({ ...base, readTicket: 't2', expiresAt: 181_000 });
    FakeWS.last!.onclose?.(); // 新連線被伺服器拒絕
    expect(e.readOnlyLinkStatus).toBe('live');
    oldWs.push(tele({ armed: true, pos_m: [0, 0, 9], telemetry_v2: v2(1_500) })); // 倒退
    expect(e.observation?.positionEnu[2]).toBe(1);
    e.dispose();
  });
});
