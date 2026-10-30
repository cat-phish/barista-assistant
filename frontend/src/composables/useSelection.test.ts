import { describe, expect, it } from 'vitest';
import { useSelection } from './useSelection';

describe('useSelection', () => {
  it('ticks rows while selecting, and starts and stops empty', () => {
    const s = useSelection();
    s.start();
    s.toggle('a');
    s.toggle('b');
    s.toggle('a');
    expect([s.selecting, [...s.ids]]).toEqual([true, ['b']]);
    s.setAll(['a', 'c']);
    expect([s.has('a'), s.has('b'), s.ids.size]).toEqual([true, false, 2]);
    s.stop();
    expect([s.selecting, s.ids.size]).toEqual([false, 0]);
  });
});
