import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStartDelay } from './useStartDelay';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
afterEach(() => vi.useRealTimers());

describe('start delay', () => {
  it('starts immediately with no delay', () => {
    const begin = vi.fn();
    const delay = useStartDelay(begin);
    delay.start(0);
    expect(begin).toHaveBeenCalledExactlyOnceWith(10_000);
    expect(delay.remaining.value).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([3, 5] as const)('counts down %s seconds without adding them to brew time', (seconds) => {
    const begin = vi.fn();
    const delay = useStartDelay(begin);
    delay.start(seconds);
    expect(delay.remaining.value).toBe(seconds);
    for (let elapsed = 1; elapsed < seconds; elapsed++) {
      vi.advanceTimersByTime(1000);
      expect(delay.remaining.value).toBe(seconds - elapsed);
      expect(begin).not.toHaveBeenCalled();
    }
    vi.advanceTimersByTime(1000);
    expect(begin).toHaveBeenCalledExactlyOnceWith(10_000 + seconds * 1000);
    expect(delay.remaining.value).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('a second tap starts immediately and cancels the pending start', () => {
    const begin = vi.fn();
    const delay = useStartDelay(begin);
    delay.start(5);
    vi.advanceTimersByTime(1200);
    delay.start(5);
    expect(begin).toHaveBeenCalledExactlyOnceWith(11_200);
    vi.advanceTimersByTime(5000);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('cancel/unmount prevents the delayed start and supports a fresh countdown', () => {
    const begin = vi.fn();
    const delay = useStartDelay(begin);
    delay.start(3);
    vi.advanceTimersByTime(2000);
    delay.cancel();
    vi.advanceTimersByTime(5000);
    expect(delay.remaining.value).toBe(0);
    expect(begin).not.toHaveBeenCalled();
    delay.start(3);
    vi.advanceTimersByTime(3000);
    expect(begin).toHaveBeenCalledExactlyOnceWith(20_000);
  });

  it('uses the intended deadline when the browser delivers a callback late', () => {
    const begin = vi.fn();
    const delay = useStartDelay(begin);
    delay.start(3);
    vi.setSystemTime(20_000);
    vi.advanceTimersToNextTimer();
    expect(begin).toHaveBeenCalledExactlyOnceWith(13_000);
    expect(delay.remaining.value).toBe(0);
  });
});
