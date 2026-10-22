import { describe, expect, it } from 'vitest';

import { createMode2Profile, toStoredDeviceProfile } from '../../src/input/device-profile';
import {
  createMemoryKeyValueStore,
  createProfileStore,
  parseStoredProfile,
  serializeStoredProfile,
} from '../../src/ui/profile-store';

describe('ProfileKeyValueStore (memory)', () => {
  it('returns null for a key that was never written', async () => {
    const store = createMemoryKeyValueStore();
    expect(await store.get('missing')).toBeNull();
    expect(await store.keys()).toEqual([]);
  });

  it('puts and gets a value and lists its key', async () => {
    const store = createMemoryKeyValueStore();
    await store.put('k1', { a: 1 });
    expect(await store.get('k1')).toEqual({ a: 1 });
    expect(await store.keys()).toEqual(['k1']);
  });

  it('overwrites and deletes values', async () => {
    const store = createMemoryKeyValueStore();
    await store.put('k1', 1);
    await store.put('k1', 2);
    expect(await store.get('k1')).toBe(2);
    await store.delete('k1');
    expect(await store.get('k1')).toBeNull();
    expect(await store.keys()).toEqual([]);
  });
});

describe('ProfileStore', () => {
  it('writes a profile and reads it back with the same identity', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    const profile = createMode2Profile('RadioMaster EdgeTX (Vendor: 0483)');
    await store.write(profile);

    const restored = await store.read('RadioMaster EdgeTX (Vendor: 0483)');
    expect(restored?.profile).toEqual(profile);
    expect(typeof restored?.savedAtMs).toBe('number');
    expect(restored?.savedAtMs ?? 0).toBeGreaterThan(0);
  });

  it('returns null for an unknown profile id', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    expect(await store.read('no-such-device')).toBeNull();
  });

  it('ignores a corrupted record instead of throwing', async () => {
    const kv = createMemoryKeyValueStore();
    await kv.put('fde.device-profile/no-such-device', { not: 'a profile' });
    const store = createProfileStore(kv);
    expect(await store.read('no-such-device')).toBeNull();
  });

  it('ignores a foreign schema and a payload missing axes', async () => {
    const kv = createMemoryKeyValueStore();
    await kv.put('fde.device-profile/foreign', { schema: 'something-else' });
    await kv.put('fde.device-profile/bad', { schema: 'fde.device-profile/1', profile: { id: 'x' } });
    const store = createProfileStore(kv);
    expect(await store.read('foreign')).toBeNull();
    expect(await store.read('bad')).toBeNull();
  });

  it('lists only valid profiles and overwrites a duplicate id', async () => {
    const kv = createMemoryKeyValueStore();
    const store = createProfileStore(kv);

    const first = createMode2Profile('pad-a');
    const second = createMode2Profile('pad-b');
    await store.write(first);
    await store.write(second);
    await store.write({ ...first, unsupported: true });

    const listed = await store.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((p) => p.id).sort()).toEqual(['pad-a', 'pad-b']);
    expect((await store.read('pad-a'))?.profile.unsupported).toBe(true);
  });

  it('removes a stored profile', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    const profile = createMode2Profile('pad-c');
    await store.write(profile);
    await store.remove('pad-c');
    expect(await store.read('pad-c')).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it('keeps an explicitly passed capture timestamp instead of Date.now()', async () => {
    // 自動匯入必須以擷取檔自身的 savedAtMs 落庫：否則一份舊的自動匯入
    // 會頂著「剛剛寫入」的時間戳，讓之後更新的擷取檔永遠蓋不掉它。
    const store = createProfileStore(createMemoryKeyValueStore());
    const captureTime = 1_792_530_179_595; // 2026-10-21 pitch/roll 復位檔
    await store.write(createMode2Profile('pad-capture'), captureTime);
    expect((await store.read('pad-capture'))?.savedAtMs).toBe(captureTime);
  });

  it('auto-import provenance: an older capture stays replaceable by a newer capture', async () => {
    // 教師實際踩到的坑：08-20 的 source 互換檔先被自動匯入（舊行為蓋上
    // Date.now()），導致 10-21 的復位檔因「本機較新」而被拒絕覆蓋。
    const store = createProfileStore(createMemoryKeyValueStore());
    const swappedCapture = { ...createMode2Profile('pad'), label: 'axesswap (錯誤)' };
    const restoredCapture = { ...createMode2Profile('pad'), label: 'pitchroll-restore (修正)' };
    await store.write(swappedCapture, 1_700_000_000_000); // 08-20 擷取
    await store.write(restoredCapture, 1_792_530_179_595); // 10-21 擷取（更新）
    const stored = await store.read('pad');
    expect(stored?.profile.label).toBe('pitchroll-restore (修正)');
  });
});

describe('profile JSON import/export', () => {
  it('round-trips a profile through a JSON string', () => {
    const profile = createMode2Profile('RadioLink AT9S', { label: 'RadioLink 模拟器' });
    const text = serializeStoredProfile(profile, 1_700_000_000_000);
    expect(text).toContain('fde.device-profile/1');

    const parsed = parseStoredProfile(text);
    expect(parsed).toEqual(profile);
  });

  it('rejects malformed JSON and wrong schemas', () => {
    expect(parseStoredProfile('{ not json')).toBeNull();
    expect(parseStoredProfile('{"schema":"nope"}')).toBeNull();
    expect(parseStoredProfile('')).toBeNull();
  });

  it('matches the stored schema written by toStoredDeviceProfile', () => {
    const profile = createMode2Profile('pad');
    const viaStore = toStoredDeviceProfile(profile, 5);
    expect(parseStoredProfile(JSON.stringify(viaStore))).toEqual(profile);
  });
});
