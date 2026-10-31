// Press and hold, for mouse and touch alike. A finger drifts a little while
// held, so only moving further than that (a scroll, say) cancels it.
export const LONG_PRESS_MS = 250;
const DRIFT_PX = 10;

export interface LongPress {
  start(x: number, y: number, onHold: () => void): void;
  /** The pointer moved: false once that has cancelled the press. */
  move(x: number, y: number): boolean;
  cancel(): void;
  /** Whether the click ending this press belongs to the hold, so it's ignored. */
  held(): boolean;
}

export function createLongPress(ms = LONG_PRESS_MS): LongPress {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin = { x: 0, y: 0 };
  let fired = false;

  function cancel(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  return {
    start(x, y, onHold) {
      cancel();
      fired = false; // a touch hold can end without a click to clear it
      origin = { x, y };
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        onHold();
      }, ms);
    },
    move(x, y) {
      if (timer === null) return false;
      if (Math.hypot(x - origin.x, y - origin.y) <= DRIFT_PX) return true;
      cancel();
      return false;
    },
    cancel,
    held() {
      const was = fired;
      fired = false;
      return was;
    },
  };
}
