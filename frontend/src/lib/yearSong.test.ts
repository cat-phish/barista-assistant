import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_SONG_URL, OWN_SONG_URL, SONG_VOLUME, songSource, songUrl, startYearSong, yearSong } from './yearSong';

describe('Your Year in Coffee music (backlog 65)', () => {
  it('plays your own song when you have one and the server allows it, else the built-in', () => {
    expect(songSource(true, true)).toBe(OWN_SONG_URL);
    expect(songSource(false, true)).toBe(BUILTIN_SONG_URL); // the server turned uploads off
    expect(songSource(true, false)).toBe(BUILTIN_SONG_URL); // nothing uploaded
    expect(songSource(false, false)).toBe(BUILTIN_SONG_URL);
  });
});

describe('the shared player (backlog 65 step 5)', () => {
  const user = (yearMusic: boolean, own = false) => ({
    features: { yearSongUploads: true },
    song: own ? { uploadedAt: '2026-11-01T00:00:00.000Z' } : null,
    preferences: { yearMusic },
  });

  it('points at your own song with its upload time, else the built-in', () => {
    expect(songUrl(user(true, true))).toBe(`${OWN_SONG_URL}?v=2026-11-01T00%3A00%3A00.000Z`);
    expect(songUrl(user(true))).toBe(BUILTIN_SONG_URL);
    expect(songUrl(null)).toBe(BUILTIN_SONG_URL);
  });

  it('a tap starts it from the beginning only when Play music is on', () => {
    // No DOM in these tests: a stand-in player.
    const play = vi.fn();
    class FakeAudio {
      src = '';
      loop = false;
      preload = '';
      volume = 1;
      currentTime = 42;
      paused = true;
      play = async () => {
        play();
        this.paused = false;
      };
      pause = () => (this.paused = true);
    }
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', { location: { href: 'https://cafe.example/insights' } });
    startYearSong(user(false));
    expect(play).not.toHaveBeenCalled();
    startYearSong(user(true));
    expect(play).toHaveBeenCalledTimes(1);
    expect(yearSong()).toMatchObject({ src: 'https://cafe.example/music/year-in-coffee.mp3', loop: true, currentTime: 0, volume: SONG_VOLUME });
    expect(yearSong()).toBe(yearSong()); // one player for the app
    vi.unstubAllGlobals();
  });
});
