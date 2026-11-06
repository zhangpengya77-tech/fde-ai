// 練飛成績同步測試：已登入存檔、未登入提示、GitHub 頁面不送、主機離線不影響練習
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeInputSource, syncPractice, type PracticeRecord } from '../../src/report/practice-sync';

const rec: PracticeRecord = { mode: 'inspection', title: '巡檢', score: 80, duration_seconds: 60, input_source: '鍵盤' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('練飛成績同步', () => {
  it('操作方式：USB 遙控器型號一律記為實體遙控器', () => {
    expect(normalizeInputSource('keyboard', '鍵盤')).toBe('鍵盤');
    expect(normalizeInputSource('adapter', '手機遙控器')).toBe('手機遙控器');
    expect(normalizeInputSource('adapter', 'RadioMaster Pocket')).toBe('實體遙控器');
  });

  it('已登入：先拿 CSRF token，再帶在標頭送出，成功回傳紀錄頁', async () => {
    vi.stubGlobal('location', { hostname: 'fde-ai-v2.fde-ai-gateway.workers.dev' });
    const calls: RequestInit[] = [];
    const fake = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return init?.method === 'POST' ? json({ ok: true, records_url: '/student/sim-practice/' }, 201) : json({ logged_in: true, csrf_token: 'T0K', login_url: '/login/' });
    });
    const r = await syncPractice(rec, fake as unknown as typeof fetch);
    expect(r).toEqual({ saved: true, recordsUrl: '/student/sim-practice/' });
    expect((calls[1].headers as Record<string, string>)['X-CSRFToken']).toBe('T0K');
    expect(JSON.parse(String(calls[1].body)).score).toBe(80);
  });

  it('未登入：不送出成績，回傳登入提示', async () => {
    vi.stubGlobal('location', { hostname: 'example.test' });
    const fake = vi.fn(async () => json({ logged_in: false, csrf_token: 'x', login_url: '/login/' }));
    const r = await syncPractice(rec, fake as unknown as typeof fetch);
    expect(r).toEqual({ saved: false, reason: 'login', loginUrl: '/login/' });
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('GitHub 頁面：完全不呼叫後台', async () => {
    vi.stubGlobal('location', { hostname: 'zhangpengya77-tech.github.io' });
    const fake = vi.fn();
    const r = await syncPractice(rec, fake as unknown as typeof fetch);
    expect(r.saved).toBe(false);
    expect(fake).not.toHaveBeenCalled();
  });

  it('主機離線：回傳錯誤訊息，不丟出例外', async () => {
    vi.stubGlobal('location', { hostname: 'example.test' });
    const r = await syncPractice(rec, (async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(r).toMatchObject({ saved: false, reason: 'error' });
  });
});
