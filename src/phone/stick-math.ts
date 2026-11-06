/**
 * 手機虛擬搖桿的數學（純函式，可單元測試）2026-11-07
 *
 * 觸控點相對搖桿中心的位移 → -1..1；超出圓框就貼在邊上（不會超過 1）。
 * 美國手（Mode 2）：
 *   左搖桿：上下＝油門（放開回中＝保持高度 0.5）、左右＝轉向 yaw
 *   右搖桿：上下＝前進／後退 pitch、左右＝左移／右移 roll
 */
export interface StickXY {
  x: number;
  y: number;
}

export function touchToStick(dx: number, dy: number, radius: number, deadzone = 0.06): StickXY {
  if (radius <= 0) return { x: 0, y: 0 };
  let x = dx / radius;
  // 螢幕 y 往下為正；搖桿往上推為正
  let y = -dy / radius;
  const mag = Math.hypot(x, y);
  if (mag > 1) {
    x /= mag;
    y /= mag;
  }
  const shape = (v: number): number => (Math.abs(v) <= deadzone ? 0 : (Math.sign(v) * (Math.abs(v) - deadzone)) / (1 - deadzone));
  return { x: shape(x), y: shape(y) };
}

/** 兩支搖桿 → 送給模擬器的四軸數值 */
export function sticksToCommand(left: StickXY, right: StickXY): { roll: number; pitch: number; yaw: number; throttle: number } {
  return {
    roll: right.x,
    pitch: right.y,
    yaw: left.x,
    // 油門：中心 0.5 保持高度，往上推到底 1、往下拉到底 0
    throttle: Math.min(1, Math.max(0, 0.5 + left.y * 0.5)),
  };
}

/**
 * 體感操控（2026-11-07）：手機傾斜角度 → 右搖桿
 *
 * 瀏覽器的方向感測器（DeviceOrientation）給的是「手機本身」的角度：
 *   beta＝前後傾（直立拿時上緣往自己倒為正）、gamma＝左右傾（右側往下為正）。
 * 手機橫放時，「畫面的上下左右」和手機本身的軸向不同，要依螢幕旋轉角度換算：
 *   0°（直向）：右傾＝gamma、往自己倒＝beta
 *   90°（橫向，手機上緣在左）：右傾＝beta、往自己倒＝-gamma
 *   270°／-90°（橫向，手機上緣在右）：右傾＝-beta、往自己倒＝gamma
 *   180°：右傾＝-gamma、往自己倒＝-beta
 * 啟用時記下當下姿勢當「中立」，之後的傾斜都相對這個姿勢計算；
 * 傾斜 range 度（預設 25°）＝推到底。往前壓（上緣遠離自己）＝前進。
 */
export interface Tilt {
  /** 畫面右側往下傾的角度 */
  right: number;
  /** 畫面上緣往自己倒的角度 */
  toward: number;
}

export function screenTilt(beta: number, gamma: number, angle: number): Tilt {
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  if (a === 90) return { right: beta, toward: -gamma };
  if (a === 270) return { right: -beta, toward: gamma };
  if (a === 180) return { right: -gamma, toward: -beta };
  return { right: gamma, toward: beta };
}

export function tiltToStick(
  now: Tilt,
  neutral: Tilt,
  range = 25,
  invert: { roll: boolean; pitch: boolean } = { roll: false, pitch: false },
  deadzone = 0.08,
): StickXY {
  const shape = (v: number): number => {
    const c = Math.max(-1, Math.min(1, v));
    return Math.abs(c) <= deadzone ? 0 : (Math.sign(c) * (Math.abs(c) - deadzone)) / (1 - deadzone);
  };
  const x = shape((now.right - neutral.right) / range);
  // 上緣遠離自己（toward 變小）＝前進＝pitch 正
  const y = shape(-(now.toward - neutral.toward) / range);
  return { x: invert.roll ? -x : x, y: invert.pitch ? -y : y };
}
