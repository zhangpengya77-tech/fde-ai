import { fromStoredDeviceProfile, type DeviceProfile } from './device-profile';

/**
 * Auto-import of the latest wizard capture (M1 闭环).
 *
 * The guided calibration page persists its result to disk; the online entry
 * point (v2.0 live_backend) exposes the newest file at this endpoint, and the
 * simulator asks for it the first time it sees a controller it has no saved
 * profile for. Nothing here invents a capture: every payload must pass the same
 * `fde.device-profile/1` validation a manual import uses, and a profile is only
 * applied to the very controller it was captured from.
 */
export const DEFAULT_RC_PROFILE_ENDPOINT = '/api/rc/latest-profile';

/**
 * Bundled snapshot of the newest verified capture, copied from `public/` into
 * the build output. Relative so it resolves next to the page (e.g. /sim/ on
 * both the live backend mount and a plain static server). Only used when the
 * live endpoint is unreachable.
 */
export const BUNDLED_RC_PROFILE_ENDPOINT = 'rc-profile-latest.json';

/** Environment shape the simulator build injects (only VITE_ vars are read). */
export type AutoProfileEnv = Record<string, string | undefined>;

export function resolveAutoProfileEndpoint(env: AutoProfileEnv = {}): string {
  const fromEnv = env.VITE_RC_PROFILE_URL?.trim();
  return fromEnv ? fromEnv : DEFAULT_RC_PROFILE_ENDPOINT;
}

export interface LatestProfileSource {
  /** File name the capture was restored from ("" when the payload omitted it). */
  readonly file: string;
  readonly savedAtMs: number;
}

/**
 * Where a fetched capture came from. `live` is the online entry point
 * (`/api/rc/latest-profile` or a `VITE_RC_PROFILE_URL` override); `bundled` is
 * the page-relative snapshot shipped in `public/` (offline / static deployments).
 * The UI displays this so a teacher can see exactly which file is in effect.
 */
export type LatestProfileOrigin = 'live' | 'bundled';

export interface LatestProfilePayload {
  readonly profile: DeviceProfile;
  readonly source: LatestProfileSource;
  /** Set by `fetchLatestRcProfile`; absent for already-parsed payloads. */
  readonly origin?: LatestProfileOrigin;
}

/**
 * Validates a latest-profile response.
 *
 * Accepts either the raw stored document (`{ schema, profile, savedAtMs }`), the
 * endpoint wrapper (`{ ok: true, file, savedAtMs, profile }`), or an already
 * parsed payload (`{ profile, source: { file, savedAtMs } }`) - plus a JSON
 * string of any of them. Returns null for anything that fails validation: the
 * caller must then keep its default draft instead of guessing.
 */
export function parseLatestProfileResponse(data: unknown): LatestProfilePayload | null {
  if (typeof data === 'string') {
    try {
      return parseLatestProfileResponse(JSON.parse(data) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as Record<string, unknown>;
  if (candidate.ok === false) return null;

  const stored =
    typeof candidate.schema === 'string'
      ? candidate
      : { schema: 'fde.device-profile/1', profile: candidate.profile, savedAtMs: candidate.savedAtMs };
  const profile = fromStoredDeviceProfile(stored);
  if (!profile || profile.unsupported) return null;

  const source = (typeof candidate.source === 'object' && candidate.source !== null ? candidate.source : {}) as Record<string, unknown>;
  const file =
    typeof source.file === 'string' ? source.file : typeof candidate.file === 'string' ? candidate.file : '';
  const savedAtMs =
    typeof candidate.savedAtMs === 'number'
      ? candidate.savedAtMs
      : typeof source.savedAtMs === 'number'
        ? source.savedAtMs
        : typeof (stored as { savedAtMs?: unknown }).savedAtMs === 'number'
          ? ((stored as { savedAtMs: number }).savedAtMs as number)
          : 0;
  // An already-parsed payload (from fetchLatestRcProfile) keeps its origin so a
  // second parse never downgrades a bundled capture to a generic "live" label.
  const origin =
    typeof candidate.origin === 'string' ? (candidate.origin as LatestProfileOrigin) : undefined;
  return { profile, source: { file, savedAtMs }, ...(origin ? { origin } : {}) };
}

/**
 * Auto-import policy, kept pure so the rule is unit-testable:
 *  - the capture must belong to the controller that is actually connected;
 *  - a profile the local store already holds always wins (a manual or earlier
 *    auto import is never silently replaced).
 */
export function shouldAutoApply(
  existing: DeviceProfile | null,
  latest: DeviceProfile,
  adapterId: string,
): boolean {
  if (latest.id !== adapterId) return false;
  if (latest.unsupported) return false;
  if (existing) return false;
  return true;
}

/**
 * True when a newer ground-truth capture online should replace a locally
 * stored profile. A local manual save always carries `Date.now()` at write
 * time, so it beats any capture file; a stale profile auto-imported during an
 * earlier session (e.g. before the right-stick mapping was verified) does not.
 */
export function shouldUpgradeStoredProfile(storedSavedAtMs: number, latestSavedAtMs: number): boolean {
  return latestSavedAtMs > storedSavedAtMs;
}

/**
 * True when two profiles bind the four functions to exactly the same axes with
 * the same polarity. Used to warn a teacher whose local profile was saved while
 * a *different* (possibly wrong) mapping was in effect: the local file wins on
 * timestamps, but the disagreement must never be silent.
 */
export function sameAxisMapping(a: DeviceProfile, b: DeviceProfile): boolean {
  const roles: Array<keyof DeviceProfile['axes']> = ['roll', 'pitch', 'yaw', 'throttle'];
  return roles.every(
    (role) =>
      a.axes[role].source === b.axes[role].source &&
      a.axes[role].kind === b.axes[role].kind &&
      Boolean(a.axes[role].calibration.reverse) === Boolean(b.axes[role].calibration.reverse),
  );
}

/** Short human summary of the four bindings, e.g. `R←a0 · P←a1（反） · Y←a3 · T←a2`. */
export function describeAxisMapping(profile: DeviceProfile): string {
  const mark = (reverse: boolean): string => (reverse ? '（反）' : '');
  const axes = profile.axes;
  return [
    `R←a${axes.roll.source}${mark(axes.roll.calibration.reverse)}`,
    `P←a${axes.pitch.source}${mark(axes.pitch.calibration.reverse)}`,
    `Y←a${axes.yaw.source}${mark(axes.yaw.calibration.reverse)}`,
    `T←a${axes.throttle.source}${mark(axes.throttle.calibration.reverse)}`,
  ].join(' · ');
}

export interface FetchLatestProfileOptions {
  readonly deviceId: string;
  readonly endpoint?: string;
  /**
   * Optional second endpoint tried only when the primary one fails. Lets an
   * offline/static deployment (e.g. a plain static /sim/ mount with no live
   * API) still fly with the newest verified capture bundled at build time.
   */
  readonly fallbackEndpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Fetches and validates the latest capture. Network, timeout and validation
 * failures on the primary endpoint fall back to `fallbackEndpoint` (when
 * provided); if that fails too the result is null: a broken endpoint must
 * never block teaching.
 */
export async function fetchLatestRcProfile(options: FetchLatestProfileOptions): Promise<LatestProfilePayload | null> {
  const endpoint = options.endpoint ?? DEFAULT_RC_PROFILE_ENDPOINT;
  const primary = await fetchOnce({ ...options, endpoint });
  if (primary) return { ...primary, origin: 'live' };
  if (options.fallbackEndpoint) {
    const bundled = await fetchOnce({ ...options, endpoint: options.fallbackEndpoint });
    // 靜態快照本身沒有 file 欄位：用端點路徑作為檔名顯示。
    if (bundled) {
      const file = bundled.source.file || options.fallbackEndpoint;
      return { profile: bundled.profile, source: { ...bundled.source, file }, origin: 'bundled' };
    }
  }
  return null;
}

async function fetchOnce(options: FetchLatestProfileOptions & { endpoint: string }): Promise<LatestProfilePayload | null> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) return null;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), options.timeoutMs ?? 4000)
    : null;
  try {
    const response = await fetchImpl(options.endpoint, {
      headers: { Accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return null;
    const payload = parseLatestProfileResponse(await response.json());
    if (!payload || payload.profile.id !== options.deviceId) return null;
    return payload;
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
