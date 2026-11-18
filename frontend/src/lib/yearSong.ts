// Music on Your Year in Coffee (backlog 65, docs/api/recaps.md §11c "Motion
// and sound"): one song plays, your own if you have one, else the built-in.
export const BUILTIN_SONG_URL = '/music/year-in-coffee.mp3';
export const OWN_SONG_URL = '/api/auth/me/song';
export const SONG_VOLUME = 0.6;

// Your own song needs the server to allow uploads and one uploaded.
export function songSource(uploadsOn: boolean, hasOwn: boolean): string {
  return uploadsOn && hasOwn ? OWN_SONG_URL : BUILTIN_SONG_URL;
}
