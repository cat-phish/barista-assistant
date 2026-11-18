// Music on Your Year in Coffee (backlog 65, docs/api/recaps.md §11c "Motion
// and sound"): which file plays for the yearSong preference.
import type { UserPreferences } from '../api/types';

export const BUILTIN_SONG_URL = '/music/year-in-coffee.mp3';
export const OWN_SONG_URL = '/api/auth/me/song';
export const SONG_VOLUME = 0.6;

// null = silence. "own" needs the server to allow uploads and a song uploaded.
export function songSource(pref: UserPreferences['yearSong'], uploadsOn: boolean, hasOwn: boolean): string | null {
  if (pref === 'builtin') return BUILTIN_SONG_URL;
  if (pref === 'own' && uploadsOn && hasOwn) return OWN_SONG_URL;
  return null;
}
