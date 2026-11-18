import { describe, expect, it } from 'vitest';
import { BUILTIN_SONG_URL, OWN_SONG_URL, songSource } from './yearSong';

describe('Your Year in Coffee song (backlog 65)', () => {
  it('plays nothing until picked, the built-in one, or your own where allowed', () => {
    expect(songSource('off', true, true)).toBeNull();
    expect(songSource('builtin', false, false)).toBe(BUILTIN_SONG_URL);
    expect(songSource('own', true, true)).toBe(OWN_SONG_URL);
    expect(songSource('own', false, true)).toBeNull(); // the server turned uploads off
    expect(songSource('own', true, false)).toBeNull(); // nothing uploaded
  });
});
