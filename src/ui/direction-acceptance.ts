/**
 * 方向驗收：把「右桿前推 / 右桿右打 / 放開」三個動作的即時數據變成
 * 綠燈通過 / 紅燈失敗的判定。
 *
 * 純函式、不碰 DOM、不改任何映射：只回答「現在這一刻，pitch 是正的嗎？
 * 機體真的在往那個方向走嗎？放開後停得下來嗎？」。
 *
 * 方向約定（與 SimpleFlightController 一致，全專案唯一一套）：
 *  - 前進 = 世界 −Z；右移 = 世界 +X（heading = 0 時）。
 *  - 任意航向下：機頭 = (sin h, 0, −cos h)、右側 = (cos h, 0, sin h)，
 *    所以沿機頭的速度分量 = (sin h, −cos h)·v，沿右側的分量 = (cos h, sin h)·v。
 *
 * 2026-10-22：這兩個分量原本用 (−sin h, −cos h) / (cos h, −sin h)，與飛控的
 * 錯誤旋轉是同一個符號錯，因此驗收面板會「配合」錯誤的飛控一起判綠 —— 機體
 * 反著飛也會顯示通過。兩邊同時修正後，面板才是真的在驗收方向。
 */

export type AcceptanceKey = 'pitch' | 'roll' | 'release';
export type AcceptanceVerdict = 'idle' | 'pending' | 'pass' | 'fail';

export interface AcceptanceCommand {
  readonly roll: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly throttle: number;
}

export interface AcceptanceSample {
  /** 飛航狀態；只有 `flying` 才能驗收（否則機體不會動）。 */
  readonly state: string;
  readonly command: AcceptanceCommand;
  readonly velocity: { x: number; y: number; z: number };
  readonly headingDeg: number;
}

export interface AcceptanceJudgement {
  readonly verdict: 'pending' | 'pass' | 'fail';
  readonly detail: string;
  readonly numbers: Record<string, number>;
}

/** 推動判定門檻：歸一化值至少要這麼大才算「推了這個方向」。 */
export const ACCEPTANCE_MIN_COMMAND = 0.5;
/** 通過所需的最小速度（m/s）：證明機體真的在動，而不是只有桿在動。 */
export const ACCEPTANCE_MIN_SPEED = 0.5;
/** 放開後等待穩定的時間（秒）；由面板負責等待，這裡只做判定。 */
export const RELEASE_SETTLE_S = 1.2;
/** 放開判定：所有歸一化值小於此值視為已放開。 */
export const RELEASE_NEUTRAL = 0.1;
/** 放開後通過所需的最大殘速（m/s）。 */
export const RELEASE_MAX_SPEED = 0.1;

const SIGNED = (value: number): string => (value >= 0 ? '+' : '') + value.toFixed(2);

/** 沿機頭方向（前進）的速度分量，m/s。機頭 = (sin h, 0, −cos h)。 */
export function forwardSpeed(sample: AcceptanceSample): number {
  const radians = (sample.headingDeg * Math.PI) / 180;
  return Math.sin(radians) * sample.velocity.x - Math.cos(radians) * sample.velocity.z;
}

/** 沿機身右側（右移）的速度分量，m/s。右側 = (cos h, 0, sin h)。 */
export function rightSpeed(sample: AcceptanceSample): number {
  const radians = (sample.headingDeg * Math.PI) / 180;
  return Math.cos(radians) * sample.velocity.x + Math.sin(radians) * sample.velocity.z;
}

/** 水平合速度，m/s。 */
export function horizontalSpeed(sample: AcceptanceSample): number {
  return Math.hypot(sample.velocity.x, sample.velocity.z);
}

export function isReleased(sample: AcceptanceSample): boolean {
  return (
    Math.abs(sample.command.pitch) <= RELEASE_NEUTRAL &&
    Math.abs(sample.command.roll) <= RELEASE_NEUTRAL &&
    Math.abs(sample.command.yaw) <= RELEASE_NEUTRAL &&
    Math.abs(sample.command.throttle) <= RELEASE_NEUTRAL
  );
}

/**
 * 單一項目的即時判定。呼叫端每帧呼叫；回傳 pending 表示「繼續等」。
 * `settled` 只用於放開項：true 表示已放開並等滿 RELEASE_SETTLE_S。
 */
export function judgeAcceptance(key: AcceptanceKey, sample: AcceptanceSample, settled = false): AcceptanceJudgement {
  if (sample.state !== 'flying') {
    return {
      verdict: 'pending',
      detail: '請先解鎖並起飛（方向驗收需要在飛行狀態下進行）。',
      numbers: {},
    };
  }

  if (key === 'release') {
    if (!isReleased(sample)) {
      return { verdict: 'pending', detail: '請放開所有搖桿（含油門保持在底部）。', numbers: {} };
    }
    if (!settled) {
      return { verdict: 'pending', detail: '已放開，等待機體停止…', numbers: {} };
    }
    const speed = horizontalSpeed(sample);
    if (speed <= RELEASE_MAX_SPEED) {
      return { verdict: 'pass', detail: `放開後機體已停止（殘速 ${speed.toFixed(3)} m/s）。`, numbers: { speed } };
    }
    return {
      verdict: 'fail',
      detail: `放開 ${RELEASE_SETTLE_S.toFixed(1)} 秒後仍在移動（殘速 ${speed.toFixed(3)} m/s）：殘餘輸入或中心偏移未排除。`,
      numbers: { speed },
    };
  }

  if (key === 'pitch') {
    const pitch = sample.command.pitch;
    const forward = forwardSpeed(sample);
    if (pitch >= ACCEPTANCE_MIN_COMMAND) {
      if (forward >= ACCEPTANCE_MIN_SPEED) {
        return { verdict: 'pass', detail: `Pitch ${SIGNED(pitch)}、前進速度 ${forward.toFixed(2)} m/s。`, numbers: { pitch, forward } };
      }
      return {
        verdict: 'fail',
        detail: `Pitch 為正（${SIGNED(pitch)}）但機體未前進（前進分量 ${forward.toFixed(2)} m/s）。`,
        numbers: { pitch, forward },
      };
    }
    if (pitch <= -ACCEPTANCE_MIN_COMMAND) {
      return {
        verdict: 'fail',
        detail: `右桿前推卻得到 Pitch ${SIGNED(pitch)}（方向相反）：reverse 需要翻轉。`,
        numbers: { pitch, forward },
      };
    }
    return { verdict: 'pending', detail: '等待推動：請把右桿向前（上）推到底並保持。', numbers: { pitch, forward } };
  }

  const roll = sample.command.roll;
  const right = rightSpeed(sample);
  if (roll >= ACCEPTANCE_MIN_COMMAND) {
    if (right >= ACCEPTANCE_MIN_SPEED) {
      return { verdict: 'pass', detail: `Roll ${SIGNED(roll)}、右移速度 ${right.toFixed(2)} m/s。`, numbers: { roll, right } };
    }
    return {
      verdict: 'fail',
      detail: `Roll 為正（${SIGNED(roll)}）但機體未右移（右移分量 ${right.toFixed(2)} m/s）。`,
      numbers: { roll, right },
    };
  }
  if (roll <= -ACCEPTANCE_MIN_COMMAND) {
    return {
      verdict: 'fail',
      detail: `右桿右打卻得到 Roll ${SIGNED(roll)}（方向相反）：reverse 需要翻轉。`,
      numbers: { roll, right },
    };
  }
  return { verdict: 'pending', detail: '等待推動：請把右桿向右打到底並保持。', numbers: { roll, right } };
}

export interface AcceptanceRecord {
  readonly key: AcceptanceKey;
  readonly verdict: AcceptanceVerdict;
  readonly detail: string;
  readonly numbers: Record<string, number>;
  readonly at: string;
}

export const ACCEPTANCE_LABELS: ReadonlyArray<{ key: AcceptanceKey; label: string; hint: string }> = [
  { key: 'pitch', label: '右桿前推（Pitch）', hint: '把右桿向前推到底 → Pitch 應為正、機體應前進' },
  { key: 'roll', label: '右桿右打（Roll）', hint: '把右桿向右打到底 → Roll 應為正、機體應右移' },
  { key: 'release', label: '放開（停止）', hint: '放開所有搖桿 → 機體應在 1.2 秒內停止' },
];

/** 匯出用 JSON（schema 固定，方便貼回或存檔比對）。 */
export function buildAcceptanceReport(input: {
  capturedAt: string;
  deviceId: string | null;
  mapping: string | null;
  records: readonly AcceptanceRecord[];
}): Record<string, unknown> {
  return {
    schema: 'fde.direction-acceptance/1',
    capturedAt: input.capturedAt,
    deviceId: input.deviceId,
    mapping: input.mapping,
    results: input.records.map((record) => ({
      key: record.key,
      verdict: record.verdict,
      detail: record.detail,
      numbers: record.numbers,
      at: record.at,
    })),
  };
}
