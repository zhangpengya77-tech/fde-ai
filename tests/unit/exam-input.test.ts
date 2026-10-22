import { describe, expect, it } from 'vitest';
import { ExamInput } from '../../src/exam/exam-input';
import { createMode2Profile } from '../../src/input/device-profile';
import { createMemoryKeyValueStore, createProfileStore } from '../../src/ui/profile-store';
import type { PilotInputAdapter } from '../../src/input/PilotInputAdapter';
import type { RawPilotInput } from '../../src/input/PilotInputAdapter';

const DEVICE_ID = 'RadioMaster Pocket (VID_1209&PID_4F54)';

/** 測試用假搖桿：回報固定通道；connected 可切換。 */
class FakeAdapter implements PilotInputAdapter {
  readonly type = 'gamepad' as const;
  connected = true;
  constructor(
    readonly id: string,
    private readonly channels: number[] = [0, 0, -1, 0, 0, 0],
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {}
  disconnect(): void {}
  poll(timestampMs: number): RawPilotInput {
    return { timestampMs, channels: this.channels, buttons: [0, 0, 0, 0], connected: this.connected };
  }
}

const fakeKeyboardTarget = {
  addEventListener: () => {},
  removeEventListener: () => {},
} as unknown as Window;

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('考試輸入 — 無搖桿時回退鍵盤', () => {
  it('搖桿未連線 → 來源為鍵盤（備援）', async () => {
    const adapter = new FakeAdapter(DEVICE_ID);
    adapter.connected = false;
    const input = new ExamInput({
      adapters: [adapter],
      keyboardTarget: fakeKeyboardTarget,
      store: createProfileStore(createMemoryKeyValueStore()),
      autoProfileSource: async () => null,
    });
    await input.start();
    const result = input.tick(0);
    expect(result.source.kind).toBe('keyboard');
    expect(input.getInfo().sourceKind).toBe('keyboard');
    expect(input.getInfo().hasProfile).toBe(false);
    input.dispose();
  });
});

describe('考試輸入 — 搖桿有生效標定時用搖桿', () => {
  it('本機已有標定 → adapter 勝出，HUD 顯示 profile 與四軸映射', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    await store.write(createMode2Profile(DEVICE_ID, { label: 'RadioMaster Pocket' }), 1_000, {
      kind: 'manual',
    });
    const input = new ExamInput({
      adapters: [new FakeAdapter(DEVICE_ID)],
      keyboardTarget: fakeKeyboardTarget,
      store,
      autoProfileSource: async () => null,
    });
    await input.start();
    const result = input.tick(1000);
    expect(result.source.kind).toBe('adapter');
    const info = input.getInfo();
    expect(info.sourceKind).toBe('adapter');
    expect(info.hasProfile).toBe(true);
    expect(info.profileLabel).toBe('RadioMaster Pocket');
    expect(info.mapping).toContain('R←a0');
    expect(info.mapping).toContain('T←a2');
    input.dispose();
  });

  it('搖桿指令經 ChannelMapper：右打 roll 為正、油門回中為 0.5', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    await store.write(createMode2Profile(DEVICE_ID), 1_000, { kind: 'manual' });
    const input = new ExamInput({
      // channels: axis0=+1(roll 右打)、axis1=0、axis2=-1(油門底部休止)、axis3=0
      adapters: [new FakeAdapter(DEVICE_ID, [1, 0, -1, 0, 0, 0])],
      keyboardTarget: fakeKeyboardTarget,
      store,
      autoProfileSource: async () => null,
    });
    await input.start();
    const cmd = input.tick(1000).command;
    expect(cmd.roll).toBeGreaterThan(0.9);
    expect(cmd.pitch).toBe(0);
    expect(cmd.yaw).toBe(0);
    expect(cmd.throttle).toBeCloseTo(0, 3); // 底部休止 → 0
    input.dispose();
  });
});

describe('考試輸入 — 自動匯入最新擷取檔', () => {
  it('本機無標定 + 線上擷取檔 → 自動匯入後搖桿生效', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    const input = new ExamInput({
      adapters: [new FakeAdapter(DEVICE_ID)],
      keyboardTarget: fakeKeyboardTarget,
      store,
      autoProfileSource: async () => ({
        profile: createMode2Profile(DEVICE_ID, { label: '擷取檔標定' }),
        source: { file: 'fde-rc-calibration-2026-10-20-mode2-final.json', savedAtMs: 5_000 },
        origin: 'live',
      }),
    });
    await input.start();
    // 第一幀：標定尚未載入 → 鍵盤備援，同時觸發非同步解析。
    expect(input.tick(1000).source.kind).toBe('keyboard');
    await flush();
    // 標定落地後再 poll → 搖桿勝出。
    const result = input.tick(2000);
    expect(result.source.kind).toBe('adapter');
    const info = input.getInfo();
    expect(info.hasProfile).toBe(true);
    expect(info.profileLabel).toBe('擷取檔標定');
    expect(info.profileFile).toContain('mode2-final');
    expect(info.profileOrigin).toBe('live');
    // 已寫入本機儲存（下次仍生效）。
    const stored = await store.read(DEVICE_ID);
    expect(stored).not.toBeNull();
    expect(stored!.savedAtMs).toBe(5_000);
    input.dispose();
  });
});

describe('考試輸入 — 來源切換', () => {
  it('有搖桿時仍可手動強制鍵盤（togglePreference）', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    await store.write(createMode2Profile(DEVICE_ID), 1_000, { kind: 'manual' });
    const input = new ExamInput({
      adapters: [new FakeAdapter(DEVICE_ID)],
      keyboardTarget: fakeKeyboardTarget,
      store,
      autoProfileSource: async () => null,
    });
    await input.start();
    expect(input.tick(1000).source.kind).toBe('adapter');
    input.setPreference('keyboard');
    expect(input.getPreference()).toBe('keyboard');
    expect(input.tick(1001).source.kind).toBe('keyboard');
    input.togglePreference();
    expect(input.getPreference()).toBe('auto');
    expect(input.tick(1002).source.kind).toBe('adapter');
    input.dispose();
  });
});

describe('考試輸入 — 搖桿連線但無生效標定', () => {
  it('無本機檔且線上取不到 → 仍用鍵盤，HUD 標記 connectedWithoutProfile', async () => {
    const input = new ExamInput({
      adapters: [new FakeAdapter(DEVICE_ID)],
      keyboardTarget: fakeKeyboardTarget,
      store: createProfileStore(createMemoryKeyValueStore()),
      autoProfileSource: async () => null,
    });
    await input.start();
    input.tick(1000);
    await flush();
    input.tick(2000);
    const info = input.getInfo();
    expect(info.sourceKind).toBe('keyboard');
    expect(info.connectedWithoutProfile).toBe(true);
    expect(info.hasProfile).toBe(false);
    input.dispose();
  });
});

describe('考試輸入 — 舊標定自動升級', () => {
  it('本機檔較舊 + 線上擷取檔較新 → 升級為擷取檔', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    // 舊的自動匯入檔（savedAtMs 較小）。
    await store.write(createMode2Profile(DEVICE_ID, { label: '舊檔' }), 1_000, { kind: 'bundled' });
    const input = new ExamInput({
      adapters: [new FakeAdapter(DEVICE_ID)],
      keyboardTarget: fakeKeyboardTarget,
      store,
      autoProfileSource: async () => ({
        profile: createMode2Profile(DEVICE_ID, { label: '新檔' }),
        source: { file: 'new-capture.json', savedAtMs: 9_000 },
        origin: 'live',
      }),
    });
    await input.start();
    input.tick(1000);
    await flush();
    const stored = await store.read(DEVICE_ID);
    expect(stored!.profile.label).toBe('新檔');
    expect(stored!.savedAtMs).toBe(9_000);
    expect(input.getInfo().profileLabel).toBe('新檔');
    input.dispose();
  });

  it('本機手動儲存（savedAtMs 最新）+ 線上擷取檔軸映射不同 → 保留本機檔並標記衝突', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    const local = createMode2Profile(DEVICE_ID, { label: '本機手動檔' });
    await store.write(local, 9_000, { kind: 'manual' });
    // 線上擷取檔：不同軸映射（yaw 綁到 axis0），但 savedAtMs 較舊。
    const different = createMode2Profile(DEVICE_ID, { label: '不同映射' });
    const swapped = {
      ...different,
      axes: { ...different.axes, yaw: { ...different.axes.yaw, source: 0 } },
    };
    const input = new ExamInput({
      adapters: [new FakeAdapter(DEVICE_ID)],
      keyboardTarget: fakeKeyboardTarget,
      store,
      autoProfileSource: async () => ({
        profile: swapped,
        source: { file: 'old-swapped.json', savedAtMs: 2_000 },
        origin: 'live',
      }),
    });
    await input.start();
    input.tick(1000);
    await flush();
    const stored = await store.read(DEVICE_ID);
    expect(stored!.profile.label).toBe('本機手動檔');
    expect(stored!.savedAtMs).toBe(9_000);
    expect(input.getInfo().conflict).toBe(true);
    expect(input.getInfo().conflictMapping).toContain('Y←a0');
    input.dispose();
  });
});
