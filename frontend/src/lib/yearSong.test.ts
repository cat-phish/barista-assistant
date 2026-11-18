import { describe, expect, it } from 'vitest';
import { BUILTIN_SONG_URL, OWN_SONG_URL, songSource } from './yearSong';

describe('Your Year in Coffee music (backlog 65)', () => {
  it('plays your own song when you have one and the server allows it, else the built-in', () => {
    expect(songSource(true, true)).toBe(OWN_SONG_URL);
    expect(songSource(false, true)).toBe(BUILTIN_SONG_URL); // the server turned uploads off
    expect(songSource(true, false)).toBe(BUILTIN_SONG_URL); // nothing uploaded
    expect(songSource(false, false)).toBe(BUILTIN_SONG_URL);
  });
});
