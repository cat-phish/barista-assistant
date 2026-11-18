// Your own Year in Coffee song (docs/api/auth.md §1, "Year song"): one per
// account, at PHOTO_DIR/songs/<userId>, only while YEAR_SONG_UPLOADS=true.
// Only its owner can fetch it; it isn't in workspace backups.
import { mkdir, rename, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { eq } from "drizzle-orm";
import { users } from "@barista/shared/schema";
import { sniffAudio } from "../audioSniff.js";
import { photoDir, yearSongUploadsOn } from "../config.js";
import { db } from "../db.js";
import { sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";

export const SONG_MAX_BYTES = 10 * 1024 * 1024;
export const SONG_DIR = "songs"; // inside PHOTO_DIR; the photo sweep skips it
const SONG_NAME_MAX = 100;

export interface SongInfo {
  name: string | null;
  bytes: number;
  uploadedAt: string;
}

const songPath = (userId: string) => join(photoDir(), SONG_DIR, userId);

export async function removeSongFile(userId: string): Promise<void> {
  await rm(songPath(userId), { force: true });
}

// Files whose account is gone, or whose row no longer has a song.
export async function sweepOrphanSongs(): Promise<number> {
  const files = await readdir(join(photoDir(), SONG_DIR)).catch(() => [] as string[]);
  if (files.length === 0) return 0;
  const rows = await db.select({ id: users.id, mime: users.songMime }).from(users);
  const known = new Set(rows.filter((r) => r.mime).map((r) => r.id));
  let removed = 0;
  for (const f of files) {
    if (known.has(f)) continue;
    await rm(join(photoDir(), SONG_DIR, f), { force: true });
    removed++;
  }
  return removed;
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Control characters out, spaces collapsed; shown as plain text only.
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ").slice(0, SONG_NAME_MAX);
  return name || null;
}

function needsFeature(_req: Request, res: Response, next: NextFunction): void {
  if (yearSongUploadsOn()) return next();
  sendError(res, 403, "Song uploads are off on this server");
}

const songUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: () => {
    const n = Number(process.env.SONG_UPLOAD_LIMIT_PER_HOUR);
    return Number.isFinite(n) && n > 0 ? n : 10;
  },
  keyGenerator: (req: Request) => `songup:${req.userId ?? ipKeyGenerator(req.ip ?? "unknown")}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendError(res, 429, "Too many song uploads. Try again later.");
  },
});

const songBody = express.raw({ type: () => true, limit: SONG_MAX_BYTES });

// Mounted at /api/auth/me/song
export const yearSongRouter = Router();
yearSongRouter.use(requireAuth);

yearSongRouter.put("/", needsFeature, songUploadLimiter, songBody, async (req: Request, res: Response<{ song: SongInfo }>) => {
  const userId = authedUserId(req);
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const mime = sniffAudio(data);
  if (!mime) {
    sendError(res, 415, "Not a song file that can be played (MP3, M4A/AAC, Ogg, WebM, FLAC or WAV)");
    return;
  }
  const name = cleanName(req.query.name);
  // Written beside, then renamed, so a reader never sees half a file.
  const path = songPath(userId);
  await mkdir(join(photoDir(), SONG_DIR), { recursive: true });
  await writeFile(`${path}.partial`, data);
  await rename(`${path}.partial`, path);
  const uploadedAt = new Date();
  await db.update(users).set({ songMime: mime, songBytes: data.length, songName: name, songUploadedAt: uploadedAt }).where(eq(users.id, userId));
  res.json({ song: { name, bytes: data.length, uploadedAt: uploadedAt.toISOString() } });
});

// Uploads off: as if there were no song, so the slides play nothing.
yearSongRouter.get("/", async (req: Request, res: Response) => {
  const userId = authedUserId(req);
  const [row] = await db.select({ mime: users.songMime }).from(users).where(eq(users.id, userId));
  if (!yearSongUploadsOn() || !row?.mime) {
    sendError(res, 404, "No song uploaded");
    return;
  }
  // Played as audio and nothing else: the saved (sniffed) type, no sniffing
  // by the browser, and a sandbox should it ever be opened as a page.
  res.set({
    "Content-Type": row.mime,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": 'inline; filename="song"',
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "private, no-store",
  });
  res.sendFile(songPath(userId), { headers: { "Content-Type": row.mime } }, (err) => {
    if (err && !res.headersSent) sendError(res, 404, "No song uploaded");
  });
});

// Works with uploads off too, so a song can always be removed.
yearSongRouter.delete("/", async (req: Request, res: Response) => {
  const userId = authedUserId(req);
  await db.update(users).set({ songMime: null, songBytes: null, songName: null, songUploadedAt: null }).where(eq(users.id, userId));
  await removeSongFile(userId);
  res.status(204).end();
});
