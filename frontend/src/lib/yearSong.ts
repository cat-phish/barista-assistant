// Music on Your Year in Coffee (backlog 65, docs/api/recaps.md §11c "Motion
// and sound"): one song plays, your own if you have one, else the built-in.
export const BUILTIN_SONG_URL = '/music/year-in-coffee.mp3';
export const OWN_SONG_URL = '/api/auth/me/song';
export const SONG_VOLUME = 0.6;

// Your own song needs the server to allow uploads and one uploaded.
export function songSource(uploadsOn: boolean, hasOwn: boolean): string {
  return uploadsOn && hasOwn ? OWN_SONG_URL : BUILTIN_SONG_URL;
}

// What the song depends on in the signed-in user.
export interface SongOwner {
  features: { yearSongUploads?: boolean };
  song: { uploadedAt: string } | null;
  preferences: { yearMusic?: boolean };
}

export function songUrl(user: SongOwner | null): string {
  const uploadsOn = user?.features.yearSongUploads ?? false;
  const own = uploadsOn ? (user?.song ?? null) : null;
  const url = songSource(uploadsOn, Boolean(own));
  // A replaced song has the same address, so the upload time tells them apart.
  return own ? `${url}?v=${encodeURIComponent(own.uploadedAt)}` : url;
}

// One player for the whole app, so a tap outside the slides (the banner, the
// Insights link) can start the song: a browser plays sound only inside a tap,
// and the slides open after it.
let player: HTMLAudioElement | null = null;
export function yearSong(): HTMLAudioElement {
  if (!player) {
    player = new Audio();
    player.loop = true;
    player.preload = 'none';
  }
  return player;
}

export function setSong(url: string): HTMLAudioElement {
  const a = yearSong();
  const full = new URL(url, window.location.href).href;
  if (a.src !== full) a.src = full;
  return a;
}

// Plays it (from where it is), at the usual volume; false if the browser
// refused (no tap yet) or couldn't.
export async function playSong(url: string): Promise<boolean> {
  const a = setSong(url);
  a.volume = SONG_VOLUME;
  try {
    await a.play();
    return true;
  } catch {
    return false;
  }
}

// Called inside the tap that opens the slides: starts the song from the
// beginning when Play music is on (Settings → Recaps).
export function startYearSong(user: SongOwner | null): void {
  if (!user?.preferences.yearMusic) return;
  const url = songUrl(user);
  setSong(url).currentTime = 0;
  void playSong(url);
}

export function songPlaying(): boolean {
  return !!player && !player.paused;
}

export function stopSong(): void {
  if (!player) return;
  player.pause();
  player.currentTime = 0;
}
