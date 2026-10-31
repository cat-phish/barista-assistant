import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLongPress, LONG_PRESS_MS } from './longPress';

describe('long press', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('fires after the hold, and the click that ends it is ignored once', () => {
    const press = createLongPress();
    const onHold = vi.fn();
    press.start(0, 0, onHold);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onHold).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onHold).toHaveBeenCalledOnce();
    expect(press.held()).toBe(true);
    expect(press.held()).toBe(false);
  });

  it('leaves a quick tap alone', () => {
    const press = createLongPress();
    const onHold = vi.fn();
    press.start(0, 0, onHold);
    press.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onHold).not.toHaveBeenCalled();
    expect(press.held()).toBe(false);
  });

  it('survives a small drift, but a real move cancels it', () => {
    const press = createLongPress();
    const onHold = vi.fn();
    press.start(0, 0, onHold);
    expect(press.move(5, 5)).toBe(true);
    expect(press.move(20, 0)).toBe(false);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(onHold).not.toHaveBeenCalled();
  });

  it("doesn't swallow the next tap when a touch hold ends without a click", () => {
    const press = createLongPress();
    press.start(0, 0, vi.fn());
    vi.advanceTimersByTime(LONG_PRESS_MS);
    press.start(0, 0, vi.fn());
    press.cancel();
    expect(press.held()).toBe(false);
  });
});
