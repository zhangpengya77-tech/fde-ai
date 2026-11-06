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
