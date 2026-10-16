import type { PilotCommand } from '../../flight/types';

const controlledKeys = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f']);

export class KeyboardInputAdapter {
  private readonly pressed = new Set<string>();
  private hoverRequested = true;

  constructor(private readonly target: Window = window) {
    this.target.addEventListener('keydown', this.handleKeyDown);
    this.target.addEventListener('keyup', this.handleKeyUp);
  }

  setHover(enabled: boolean): void {
    this.hoverRequested = enabled;
  }

  poll(): PilotCommand {
    const roll = Number(this.pressed.has('d')) - Number(this.pressed.has('a'));
    const pitch = Number(this.pressed.has('w')) - Number(this.pressed.has('s'));
    const yaw = Number(this.pressed.has('e')) - Number(this.pressed.has('q'));
    const throttle = this.pressed.has('r') ? 0.75 : this.pressed.has('f') ? 0.25 : 0.5;
    const moving = roll !== 0 || pitch !== 0 || yaw !== 0 || throttle !== 0.5;

    return {
      roll,
      pitch,
      yaw,
      throttle,
      arm: true,
      flightMode: this.hoverRequested && !moving ? 'hover' : 'manual',
      gimbalYaw: 0,
      gimbalPitch: 0,
    };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.pressed.clear();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (!controlledKeys.has(key)) return;
    event.preventDefault();
    this.pressed.add(key);
    this.hoverRequested = false;
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (!controlledKeys.has(key)) return;
    event.preventDefault();
    this.pressed.delete(key);
  };
}
