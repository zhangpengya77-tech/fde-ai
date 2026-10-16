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
    expect(restored).toEqual(profile);
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
    expect((await store.read('pad-a'))?.unsupported).toBe(true);
  });

  it('removes a stored profile', async () => {
    const store = createProfileStore(createMemoryKeyValueStore());
    const profile = createMode2Profile('pad-c');
    await store.write(profile);
    await store.remove('pad-c');
    expect(await store.read('pad-c')).toBeNull();
    expect(await store.list()).toEqual([]);
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
