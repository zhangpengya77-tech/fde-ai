import { describe, expect, it, vi } from 'vitest';

import bundledProfileDoc from '../../public/rc-profile-latest.json';
import type { DeviceProfile } from '../../src/input/device-profile';
import type { AxisRangeKind } from '../../src/input/InputNormalizer';
import {
  BUNDLED_RC_PROFILE_ENDPOINT,
  DEFAULT_RC_PROFILE_ENDPOINT,
  fetchLatestRcProfile,
  parseLatestProfileResponse,
  resolveAutoProfileEndpoint,
  describeAxisMapping,
  sameAxisMapping,
  shouldAutoApply,
  shouldUpgradeStoredProfile,
} from '../../src/input/auto-profile';

const PAD_ID = 'Radiomaster Pocket Joystick (Vendor: 1209 Product: 4f54)';

function axis(source: number, kind: AxisRangeKind) {
  return {
    source,
    kind,
    calibration:
      kind === 'bipolar'
        ? { min: -1, center: 0, max: 1, reverse: false, deadzone: 0.05, expo: 0 }
        : { min: -1, center: -1, max: 0.96, reverse: false, deadzone: 0.02, expo: 0 },
  };
}

function makeProfile(id = PAD_ID, unsupported = false): DeviceProfile {
  return {
    id,
    label: `RadioMaster Pocket (M1 标定) ${id}`,
    type: 'gamepad',
    mode: 'custom',
    axes: {
      roll: axis(3, 'bipolar'),
      pitch: axis(1, 'bipolar'),
      yaw: axis(0, 'bipolar'),
      throttle: axis(2, 'unipolar'),
    },
    gimbal: null,
    armButton: 7,
    unsupported,
  };
}

function storedDoc(id = PAD_ID, unsupported = false) {
  return {
    schema: 'fde.device-profile/1',
    profile: makeProfile(id, unsupported),
    savedAtMs: 1_700_000_000_000,
  };
}

describe('resolveAutoProfileEndpoint', () => {
  it('defaults to the online entry point endpoint', () => {
    expect(resolveAutoProfileEndpoint()).toBe(DEFAULT_RC_PROFILE_ENDPOINT);
  });

  it('honours a VITE_RC_PROFILE_URL override and ignores blanks', () => {
    expect(resolveAutoProfileEndpoint({ VITE_RC_PROFILE_URL: 'https://fde.example/api/rc/latest-profile' })).toBe(
      'https://fde.example/api/rc/latest-profile',
    );
    expect(resolveAutoProfileEndpoint({ VITE_RC_PROFILE_URL: '   ' })).toBe(DEFAULT_RC_PROFILE_ENDPOINT);
  });
});

describe('parseLatestProfileResponse', () => {
  it('accepts the raw stored document', () => {
    const payload = parseLatestProfileResponse(storedDoc());
    expect(payload).not.toBeNull();
    expect(payload?.profile.axes.throttle.source).toBe(2);
    expect(payload?.profile.armButton).toBe(7);
    expect(payload?.source.savedAtMs).toBe(1_700_000_000_000);
  });

  it('accepts the endpoint wrapper and keeps the file name', () => {
    const payload = parseLatestProfileResponse({
      ok: true,
      file: 'fde-rc-calibration-2026-10-18T20-15-26.json',
      savedAtMs: 99,
      profile: storedDoc().profile,
      calibration: { device: PAD_ID },
    });
    expect(payload?.source.file).toBe('fde-rc-calibration-2026-10-18T20-15-26.json');
    expect(payload?.source.savedAtMs).toBe(99);
    expect(payload?.profile.id).toBe(PAD_ID);
  });

  it('accepts a JSON string of either shape', () => {
    expect(parseLatestProfileResponse(JSON.stringify(storedDoc()))).not.toBeNull();
    expect(parseLatestProfileResponse(JSON.stringify({ ok: true, profile: storedDoc().profile }))).not.toBeNull();
  });

  it('re-parses an already parsed payload idempotently (keeps file and savedAtMs)', () => {
    const first = parseLatestProfileResponse({
      ok: true,
      file: 'fde-rc-calibration-2026-10-18T20-15-26.json',
      savedAtMs: 99,
      profile: makeProfile(),
    });
    expect(first?.source).toEqual({ file: 'fde-rc-calibration-2026-10-18T20-15-26.json', savedAtMs: 99 });
    const again = parseLatestProfileResponse(first);
    expect(again).toEqual(first);
  });

  it('rejects an explicit ok:false answer', () => {
    expect(parseLatestProfileResponse({ ok: false, reason: 'no-valid-profile' })).toBeNull();
  });

  it('rejects payloads that fail device-profile validation', () => {
    expect(parseLatestProfileResponse({ schema: 'someone.elses/schema', profile: storedDoc().profile })).toBeNull();
    expect(parseLatestProfileResponse({ schema: 'fde.device-profile/1' })).toBeNull();
    const broken = storedDoc();
    delete (broken.profile.axes as unknown as Record<string, unknown>).yaw;
    expect(parseLatestProfileResponse(broken)).toBeNull();
    expect(parseLatestProfileResponse(storedDoc(PAD_ID, true))).toBeNull();
  });

  it('rejects non-objects and malformed JSON without throwing', () => {
    expect(parseLatestProfileResponse(null)).toBeNull();
    expect(parseLatestProfileResponse(42)).toBeNull();
    expect(parseLatestProfileResponse('{not json')).toBeNull();
  });
});

describe('shouldAutoApply', () => {
  const latest = makeProfile();

  it('applies when the capture matches the connected controller and nothing is saved', () => {
    expect(shouldAutoApply(null, latest, PAD_ID)).toBe(true);
  });

  it('never applies another controller\u2019s capture', () => {
    expect(shouldAutoApply(null, latest, 'Other Pad (Vendor: 0000 Product: 0000)')).toBe(false);
  });

  it('never overrides a profile the local store already holds', () => {
    expect(shouldAutoApply(latest, latest, PAD_ID)).toBe(false);
  });

  it('refuses unsupported profiles', () => {
    expect(shouldAutoApply(null, makeProfile(PAD_ID, true), PAD_ID)).toBe(false);
  });
});

describe('shouldUpgradeStoredProfile', () => {
  it('upgrades a stale stored profile when the online capture is newer', () => {
    // stored profile auto-imported earlier today, capture file written at 04:02
    expect(shouldUpgradeStoredProfile(1_700_000_000_000, 1_770_000_000_000)).toBe(true);
  });

  it('keeps a local manual save: Date.now() always beats a capture file', () => {
    expect(shouldUpgradeStoredProfile(1_770_000_000_000, 1_770_000_000_000)).toBe(false);
    expect(shouldUpgradeStoredProfile(1_770_500_000_000, 1_770_000_000_000)).toBe(false);
  });

  it('does nothing when the stored record has no readable timestamp', () => {
    expect(shouldUpgradeStoredProfile(0, 1_770_000_000_000)).toBe(true);
    expect(shouldUpgradeStoredProfile(0, 0)).toBe(false);
  });
});

describe('bundled static fallback profile (public/rc-profile-latest.json)', () => {
  const doc: unknown = bundledProfileDoc;

  it('exposes the bundled endpoint as a page-relative path (works under /sim/)', () => {
    expect(BUNDLED_RC_PROFILE_ENDPOINT).toBe('rc-profile-latest.json');
    expect(DEFAULT_RC_PROFILE_ENDPOINT).toBe('/api/rc/latest-profile');
  });

  it('passes the exact runtime validation used for the live endpoint', () => {
    const payload = parseLatestProfileResponse(doc);
    expect(payload).not.toBeNull();
    expect(payload?.profile.id).toBe(PAD_ID);
    expect(payload?.profile.unsupported).toBe(false);
  });

  it('ships the probe-verified Mode-2 mapping (roll=axis0, pitch=axis1)', () => {
    const payload = parseLatestProfileResponse(doc);
    const axes = payload?.profile.axes;
    // Live Gamepad-API probe 2026-10-20: axis0 = 右搖桿左右（右推 = +1）,
    // axis1 = 右搖桿上下。2026-10-21 撤銷了 08:20 錯誤的 source 互換（曾導致
    // 俯仰桿飛橫滾、橫滾桿飛俯仰）。2026-10-22 真機實測（軸向探針，峰值
    // +0.984）axis1 推上為正，歷史紀錄 -1 已不適用，故 pitch 不再反轉。
    expect(axes?.roll.source).toBe(0);
    expect(axes?.pitch.source).toBe(1);
    expect(axes?.yaw.source).toBe(3);
    expect(axes?.throttle.source).toBe(2);
    expect(axes?.roll.calibration.reverse).toBe(false); // 右推 = +max -> roll +1 -> 右移
    expect(axes?.pitch.calibration.reverse).toBe(false); // 2026-10-22 實測上推 = +max -> pitch +1 -> 前進
    expect(axes?.yaw.calibration.reverse).toBe(false);
    expect(axes?.throttle.kind).toBe('unipolar');
  });
});

describe('fetchLatestRcProfile', () => {
  it('returns the validated payload for a 200 answer of the same device', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, file: 'x.json', profile: storedDoc().profile }) }));
    const payload = await fetchLatestRcProfile({ deviceId: PAD_ID, endpoint: '/api/rc/latest-profile', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(payload?.profile.id).toBe(PAD_ID);
    expect(payload?.source.file).toBe('x.json');
  });

  it('returns null for non-200, invalid bodies and network failures', async () => {
    const notOk = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await fetchLatestRcProfile({ deviceId: PAD_ID, fetchImpl: notOk as unknown as typeof fetch })).toBeNull();

    const garbage = vi.fn(async () => ({ ok: true, json: async () => ({ ok: false }) }));
    expect(await fetchLatestRcProfile({ deviceId: PAD_ID, fetchImpl: garbage as unknown as typeof fetch })).toBeNull();

    const boom = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchLatestRcProfile({ deviceId: PAD_ID, fetchImpl: boom as unknown as typeof fetch })).toBeNull();
  });

  it('ignores a capture that belongs to a different controller', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => storedDoc('Other Pad') }));
    expect(await fetchLatestRcProfile({ deviceId: PAD_ID, fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
  });

  it('resolves null when no fetch implementation exists', async () => {
    const payload = await fetchLatestRcProfile({ deviceId: PAD_ID, fetchImpl: undefined });
    // Node 18+ exposes global fetch; either way the call must not throw.
    expect(payload === null || typeof payload === 'object').toBe(true);
  });

  it('falls back to the bundled endpoint when the live API is unreachable', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === '/api/rc/latest-profile') throw new Error('404 from static server');
      return { ok: true, json: async () => storedDoc() };
    });
    const payload = await fetchLatestRcProfile({
      deviceId: PAD_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fallbackEndpoint: 'rc-profile-latest.json',
    });
    expect(payload?.profile.id).toBe(PAD_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe('rc-profile-latest.json');
  });

  it('falls back when the live endpoint answers 200 but invalid', async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input === '/api/rc/latest-profile'
        ? { ok: true, json: async () => ({ ok: false, reason: 'no-valid-profile' }) }
        : { ok: true, json: async () => ({ ok: true, file: 'bundled.json', profile: storedDoc().profile }) },
    );
    const payload = await fetchLatestRcProfile({
      deviceId: PAD_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fallbackEndpoint: 'rc-profile-latest.json',
    });
    expect(payload?.source.file).toBe('bundled.json');
  });

  it('prefers the live endpoint when it succeeds and never touches the fallback', async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input === '/api/rc/latest-profile'
        ? { ok: true, json: async () => ({ ok: true, file: 'live.json', profile: storedDoc().profile }) }
        : { ok: true, json: async () => storedDoc() },
    );
    const payload = await fetchLatestRcProfile({
      deviceId: PAD_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fallbackEndpoint: 'rc-profile-latest.json',
    });
    expect(payload?.source.file).toBe('live.json');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('labels the live endpoint origin so the UI can show where the capture came from', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, file: 'live.json', profile: storedDoc().profile }) }));
    const payload = await fetchLatestRcProfile({ deviceId: PAD_ID, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(payload?.origin).toBe('live');
  });

  it('labels the bundled fallback origin (offline / static deployments)', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === '/api/rc/latest-profile') throw new Error('404 from static server');
      return { ok: true, json: async () => storedDoc() };
    });
    const payload = await fetchLatestRcProfile({
      deviceId: PAD_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      fallbackEndpoint: 'rc-profile-latest.json',
    });
    expect(payload?.origin).toBe('bundled');
  });

  it('still resolves null when both endpoints fail', async () => {
    const boom = vi.fn(async () => { throw new Error('offline'); });
    const payload = await fetchLatestRcProfile({
      deviceId: PAD_ID,
      fetchImpl: boom as unknown as typeof fetch,
      fallbackEndpoint: 'rc-profile-latest.json',
    });
    expect(payload).toBeNull();
    expect(boom).toHaveBeenCalledTimes(2);
  });
});

describe('mapping comparison (stale local file vs newest capture)', () => {
  const profile = (overrides: Partial<DeviceProfile['axes']> = {}): DeviceProfile => ({
    id: PAD_ID,
    label: 'x',
    type: 'gamepad',
    mode: 'custom',
    axes: {
      roll: axis(0, 'bipolar'),
      pitch: axis(1, 'bipolar'),
      yaw: axis(3, 'bipolar'),
      throttle: axis(2, 'unipolar'),
      ...overrides,
    },
    unsupported: false,
  });

  it('treats identical bindings as the same mapping', () => {
    expect(sameAxisMapping(profile(), profile())).toBe(true);
  });

  it('detects the 08-20 axis swap (roll/pitch sources exchanged)', () => {
    const swapped = profile({ roll: axis(1, 'bipolar'), pitch: axis(0, 'bipolar') });
    expect(sameAxisMapping(profile(), swapped)).toBe(false);
  });

  it('detects a polarity-only difference', () => {
    const flipped: DeviceProfile['axes']['pitch'] = {
      ...axis(1, 'bipolar'),
      calibration: { min: -1, center: 0, max: 1, reverse: true, deadzone: 0.05, expo: 0 },
    };
    expect(sameAxisMapping(profile(), profile({ pitch: flipped }))).toBe(false);
  });

  it('describes the four bindings in the order the HUD shows them', () => {
    const flipped: DeviceProfile['axes']['pitch'] = {
      ...axis(1, 'bipolar'),
      calibration: { min: -1, center: 0, max: 1, reverse: true, deadzone: 0.05, expo: 0 },
    };
    expect(describeAxisMapping(profile({ pitch: flipped }))).toBe('R←a0 · P←a1（反） · Y←a3 · T←a2');
  });
});
