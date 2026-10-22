/**
 * 輸入鏈路即時診斷（HUD 用）：raw → normalized → command → 世界位移。
 *
 * 目的只有一個：推桿的那一瞬間，讓人一眼看出「是哪一層出錯」。
 *
 *   映射層（normalizer / mapper）出錯 → raw 有值但 norm 是 0、或 cmd 與 norm 反向
 *   飛控層（航向旋轉）出錯         → cmd 明明是正的，機體卻往機頭的反方向走
 *   場景層（模型朝向）出錯         → cmd 與世界位移都對，但畫面上機頭指錯方向
 *
 * 純函式、不碰 DOM、不改任何映射。方向約定與 SimpleFlightController 一致：
 * 機頭 = (sin h, 0, −cos h)、右側 = (cos h, 0, sin h)。
 */

export type ChainRole = 'pitch' | 'roll';
export type ChainLayer = 'idle' | 'normalizer' | 'mapper' | 'flight' | 'ok';

/** 低於此值視為「沒有推動」，不做任何判定（避免靜止雜訊被判成錯誤）。 */
export const CHAIN_MIN_SIGNAL = 0.2;
/** 低於此速度（m/s）視為「機體沒動」，用來區分「沒動」與「走錯方向」。 */
export const CHAIN_MIN_SPEED = 0.2;

export interface ChainAxes {
  readonly roll: { readonly source: number };
  readonly pitch: { readonly source: number };
}

export interface ChainSample {
  readonly rawChannels: readonly number[];
  readonly normalized: { readonly roll: number; readonly pitch: number };
  readonly command: { readonly roll: number; readonly pitch: number };
  readonly velocity: { readonly x: number; readonly z: number };
  readonly headingDeg: number;
  readonly axes: ChainAxes;
  /** 只有飛行中才可能位移；其餘狀態（未解鎖/起飛中/任務失敗停在地上）不判定。 */
  readonly flying: boolean;
}

export interface ChainRow {
  readonly role: ChainRole;
  readonly axis: number;
  /** 該角色對應通道的原始值（未校正）。 */
  readonly raw: number;
  readonly norm: number;
  readonly cmd: number;
  /** 機體沿機頭方向的實際速度分量（m/s）。 */
  readonly forward: number;
  /** 機體沿右側方向的實際速度分量（m/s）。 */
  readonly right: number;
  /** 這一列自己的判定。 */
  readonly verdict: 'idle' | 'ok' | 'reversed' | 'no-motion';
}

export interface ChainReport {
  readonly rows: readonly ChainRow[];
  readonly layer: ChainLayer;
  readonly message: string;
}

const SIGNED = (value: number): string => (value >= 0 ? '+' : '') + value.toFixed(2);

/** 機頭方向的單位向量 (sin h, −cos h)。 */
export function noseVector(headingDeg: number): { x: number; z: number } {
  const radians = (headingDeg * Math.PI) / 180;
  return { x: Math.sin(radians), z: -Math.cos(radians) };
}

/** 右側方向的單位向量 (cos h, sin h)。 */
export function rightVector(headingDeg: number): { x: number; z: number } {
  const radians = (headingDeg * Math.PI) / 180;
  return { x: Math.cos(radians), z: Math.sin(radians) };
}

function rawAt(channels: readonly number[], source: number): number {
  const value = channels[source];
  return Number.isFinite(value) ? value : 0;
}

/** 單列判定：cmd 有推動量時，比較機體實際走向與 cmd 的符號。 */
function judgeRow(
  role: ChainRole,
  cmd: number,
  forward: number,
  right: number,
  flying: boolean,
): ChainRow['verdict'] {
  if (Math.abs(cmd) < CHAIN_MIN_SIGNAL) return 'idle';
  if (!flying) return 'idle';
  const component = role === 'pitch' ? forward : right;
  if (Math.abs(component) < CHAIN_MIN_SPEED) return 'no-motion';
  return Math.sign(component) === Math.sign(cmd) ? 'ok' : 'reversed';
}

/**
 * 產生一帧的鏈路報告。
 *
 * `layer` 是「最上游那個出錯的層」，優先序：normalizer → mapper → flight → ok。
 * 之所以從上游往下判，是因為下游的值本來就由上游決定：只要 norm 就已經是 0，
 * 後面 cmd 是 0 只是結果，不是原因。
 */
export function describeChain(sample: ChainSample): ChainReport {
  const nose = noseVector(sample.headingDeg);
  const right = rightVector(sample.headingDeg);
  const forwardSpeed = nose.x * sample.velocity.x + nose.z * sample.velocity.z;
  const rightSpeed = right.x * sample.velocity.x + right.z * sample.velocity.z;

  const build = (role: ChainRole): ChainRow => {
    const axis = role === 'pitch' ? sample.axes.pitch.source : sample.axes.roll.source;
    const cmd = role === 'pitch' ? sample.command.pitch : sample.command.roll;
    return {
      role,
      axis,
      raw: rawAt(sample.rawChannels, axis),
      norm: role === 'pitch' ? sample.normalized.pitch : sample.normalized.roll,
      cmd,
      forward: forwardSpeed,
      right: rightSpeed,
      verdict: judgeRow(role, cmd, forwardSpeed, rightSpeed, sample.flying),
    };
  };

  const rows = [build('pitch'), build('roll')];

  // 哪一列「有推動意圖」就用它來判斷出錯的層。注意「有推動」要看整條鏈路
  // （raw / norm / cmd 任一有值），否則 source 綁錯時 cmd 剛好是 0，會被誤判成
  // 「沒在推」而回報 idle —— 那正是最需要被指出來的情況。
  const signalOf = (row: ChainRow): number => Math.max(Math.abs(row.raw), Math.abs(row.norm), Math.abs(row.cmd));
  const candidates = rows.filter((row) => signalOf(row) >= CHAIN_MIN_SIGNAL);
  const activeRow = candidates.find((row) => row.verdict === 'reversed')
    ?? candidates.sort((a, b) => signalOf(b) - signalOf(a))[0];

  if (!activeRow) {
    return { rows, layer: 'idle', message: '靜止：推桿後這一列會顯示 raw → norm → cmd → 位移。' };
  }

  if (!sample.flying) {
    return {
      rows,
      layer: 'idle',
      message: '未在飛行狀態：機體不會位移，先解鎖並起飛才看得到位移這一欄。',
    };
  }

  const label = activeRow.role === 'pitch' ? 'Pitch' : 'Roll';
  const sign = Math.sign(activeRow.cmd) || 1;

  // 1) 歸一化層：原始通道有動，歸一化卻是 0（source 綁錯、死區過大、通道不存在）。
  if (Math.abs(activeRow.raw) >= CHAIN_MIN_SIGNAL && Math.abs(activeRow.norm) < 0.05) {
    return {
      rows,
      layer: 'normalizer',
      message: `歸一化層：${label} raw ${SIGNED(activeRow.raw)}（axis${activeRow.axis}）卻得到 norm ${SIGNED(activeRow.norm)} —— source 綁錯或死區過大。`,
    };
  }

  // 2) 映射層：歸一化有值，但指令是 0 或反向。
  if (Math.abs(activeRow.norm) >= CHAIN_MIN_SIGNAL && Math.abs(activeRow.cmd) < 0.05) {
    return {
      rows,
      layer: 'mapper',
      message: `映射層：${label} norm ${SIGNED(activeRow.norm)} 卻得到 cmd ${SIGNED(activeRow.cmd)} —— 指令被吞掉了（過期樣本／懸停模式）。`,
    };
  }
  if (Math.abs(activeRow.cmd) >= CHAIN_MIN_SIGNAL && sign * activeRow.norm < 0) {
    return {
      rows,
      layer: 'mapper',
      message: `映射層：${label} norm ${SIGNED(activeRow.norm)} 與 cmd ${SIGNED(activeRow.cmd)} 反向 —— reverse 或映射寫反。`,
    };
  }

  // 3) 飛控層：指令正確，但機體在機身座標裡的走向與指令相反 / 沒動。
  if (activeRow.verdict === 'reversed') {
    const component = activeRow.role === 'pitch' ? activeRow.forward : activeRow.right;
    return {
      rows,
      layer: 'flight',
      message: `飛控層：cmd ${SIGNED(activeRow.cmd)} 但機體沿機頭/右側的分量是 ${SIGNED(component)} m/s —— 航向旋轉把方向轉反了。`,
    };
  }
  if (activeRow.verdict === 'no-motion') {
    return {
      rows,
      layer: 'flight',
      message: `飛控層：cmd ${SIGNED(activeRow.cmd)} 但機體沒有對應方向的位移 —— 狀態不是飛行中，或速度被其他邏輯壓住。`,
    };
  }

  return {
    rows,
    layer: 'ok',
    message: `鏈路正常：${label} cmd ${SIGNED(activeRow.cmd)}，機體沿機頭 ${SIGNED(activeRow.forward)} / 右側 ${SIGNED(activeRow.right)} m/s。`,
  };
}
