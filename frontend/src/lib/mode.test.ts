import { beforeEach, describe, expect, it, vi } from 'vitest';
import { headerMode, lastMode, lastPage, modeOf, rememberPage } from './mode';

describe('modeOf', () => {
  it('is roast under /roast only', () => {
    expect(modeOf('/roast')).toBe('roast');
    expect(modeOf('/roast/green/new')).toBe('roast');
    expect(modeOf('/roasters')).toBe('brew');
    expect(modeOf('/brew')).toBe('brew');
    expect(modeOf('/')).toBe('brew');
  });
});

describe('remembering the mode', () => {
  // The tests run without a browser: a Map stands in for localStorage.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  });

  it('opens on Brew until something is remembered, or without storage', () => {
    expect(lastMode('ws')).toBe('brew');
    expect(lastPage('ws', 'roast')).toBeNull();
    vi.stubGlobal('localStorage', undefined);
    rememberPage('ws', '/roast/green');
    expect(lastMode('ws')).toBe('brew');
  });
  it('keeps the last mode and the last page in each, per workspace', () => {
    rememberPage('ws', '/journal');
    rememberPage('ws', '/roast/setup');
    expect(lastMode('ws')).toBe('roast');
    expect(lastPage('ws', 'brew')).toBe('/journal');
    expect(lastPage('ws', 'roast')).toBe('/roast/setup');
    rememberPage('ws', '/beans?x=1');
    expect(lastMode('ws')).toBe('brew');
    expect(lastPage('ws', 'roast')).toBe('/roast/setup');
    expect(lastPage('ws', 'brew')).toBe('/beans?x=1');
    expect(lastMode('other')).toBe('brew');
  });
  it('keeps the last mode in Settings, which belongs to both', () => {
    rememberPage('ws', '/roast/green');
    expect(headerMode('/settings/defaults', 'ws')).toBe('roast');
    expect(headerMode('/journal', 'ws')).toBe('brew');
    expect(headerMode('/settings/account', null)).toBe('brew');
  });
  it('ignores what it did not write', () => {
    localStorage.setItem('barista.mode.ws', '{"mode":"roast","roast":"//evil.example","brew":"/roast/green"}');
    expect(lastMode('ws')).toBe('roast');
    expect(lastPage('ws', 'roast')).toBeNull();
    expect(lastPage('ws', 'brew')).toBeNull();
    localStorage.setItem('barista.mode.ws', 'not json');
    expect(lastMode('ws')).toBe('brew');
  });
});
