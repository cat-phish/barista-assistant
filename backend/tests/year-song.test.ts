import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sniffAudio } from "../src/audioSniff.js";
import { photoDir } from "../src/config.js";
import { SONG_DIR, SONG_MAX_BYTES } from "../src/routes/yearSong.js";
import { newUser } from "./helpers.js";

// docs/api/auth.md §1, "Year song"
const mp3 = Buffer.concat([Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000", "latin1"), Buffer.alloc(200, 1)]);
const path = "/api/auth/me/song";
const songFile = (userId: string) => join(photoDir(), SONG_DIR, userId);

describe("Year song upload (docs/api/auth.md §1)", () => {
  beforeEach(() => {
    process.env.YEAR_SONG_UPLOADS = "true";
  });
  afterEach(() => {
    delete process.env.YEAR_SONG_UPLOADS;
  });

  it("uploads, plays back to its owner only, and removes", async () => {
    const me = await newUser("song");
    const put = await me.agent.put(`${path}?name=${encodeURIComponent("  Morning\u0007  tune ")}`).set("content-type", "application/octet-stream").send(mp3);
    expect(put.status).toBe(200);
    expect(put.body.song).toMatchObject({ name: "Morning tune", bytes: mp3.length });
    expect(existsSync(songFile(me.id))).toBe(true);

    const meRes = await me.agent.get("/api/auth/me");
    expect(meRes.body.user.song).toMatchObject({ name: "Morning tune", bytes: mp3.length });
    expect(meRes.body.user.features).toEqual({ yearSongUploads: true });

    const get = await me.agent.get(path).buffer(true);
    expect(get.status).toBe(200);
    expect(get.headers["content-type"]).toBe("audio/mpeg");
    expect(get.headers["x-content-type-options"]).toBe("nosniff");
    expect(get.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
    expect(get.headers["cache-control"]).toBe("private, no-store");
    expect(get.headers["content-disposition"]).toBe('inline; filename="song"');

    const other = await newUser("song");
    expect((await other.agent.get(path)).status).toBe(404); // only ever your own

    expect((await me.agent.delete(path)).status).toBe(204);
    expect(existsSync(songFile(me.id))).toBe(false);
    expect((await me.agent.get(path)).status).toBe(404);
    expect((await me.agent.get("/api/auth/me")).body.user.song).toBeNull();
  });

  it("checks the file's own bytes, not its name or type", async () => {
    const me = await newUser("song");
    const html = Buffer.from("<!doctype html><script>alert(1)</script>".padEnd(64, " "));
    const res = await me.agent.put(`${path}?name=tune.mp3`).set("content-type", "audio/mpeg").send(html);
    expect(res.status).toBe(415);
    expect(existsSync(songFile(me.id))).toBe(false);
  });

  it("refuses a file over 10 MB", async () => {
    const me = await newUser("song");
    const big = Buffer.concat([mp3, Buffer.alloc(SONG_MAX_BYTES)]);
    expect((await me.agent.put(path).set("content-type", "application/octet-stream").send(big)).status).toBe(413);
  });

  it("limits uploads per person per hour", async () => {
    const before = process.env.SONG_UPLOAD_LIMIT_PER_HOUR;
    process.env.SONG_UPLOAD_LIMIT_PER_HOUR = "2";
    try {
      const me = await newUser("song");
      const send = () => me.agent.put(path).set("content-type", "application/octet-stream").send(mp3);
      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(429);
    } finally {
      process.env.SONG_UPLOAD_LIMIT_PER_HOUR = before;
    }
  });

  it("goes with the account", async () => {
    const me = await newUser("song");
    await me.agent.put(path).set("content-type", "application/octet-stream").send(mp3);
    expect((await me.agent.delete("/api/auth/me").send({ password: me.password })).status).toBe(204);
    expect(existsSync(songFile(me.id))).toBe(false);
  });
});

describe("Year song with uploads off", () => {
  it("can't upload or play, but can still remove", async () => {
    const me = await newUser("song");
    expect((await me.agent.get("/api/auth/me")).body.user.features).toEqual({ yearSongUploads: false });
    expect((await me.agent.put(path).set("content-type", "application/octet-stream").send(mp3)).status).toBe(403);
    expect((await me.agent.get(path)).status).toBe(404);
    expect((await me.agent.delete(path)).status).toBe(204);
  });
});

describe("sniffAudio", () => {
  const head = (s: string, pad = 16) => Buffer.concat([Buffer.from(s, "latin1"), Buffer.alloc(pad)]);
  it("knows each type by its first bytes", () => {
    expect(sniffAudio(head("ID3"))).toBe("audio/mpeg");
    expect(sniffAudio(head("\xff\xfb\x90\x00"))).toBe("audio/mpeg"); // MPEG-1 layer III frame
    expect(sniffAudio(head("\xff\xf1\x50\x80"))).toBe("audio/aac"); // ADTS
    expect(sniffAudio(head("\x00\x00\x00\x20ftypM4A "))).toBe("audio/mp4");
    expect(sniffAudio(head("OggS"))).toBe("audio/ogg");
    expect(sniffAudio(head("\x1a\x45\xdf\xa3"))).toBe("audio/webm");
    expect(sniffAudio(head("fLaC"))).toBe("audio/flac");
    expect(sniffAudio(head("RIFF\x00\x00\x00\x00WAVE"))).toBe("audio/wav");
  });
  it("refuses anything else", () => {
    expect(sniffAudio(head("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull();
    expect(sniffAudio(head("\x00\x00\x00\x20ftypqt  "))).toBeNull(); // a QuickTime video
    expect(sniffAudio(head("\x89PNG\r\n\x1a\n"))).toBeNull();
    expect(sniffAudio(Buffer.from("ID3"))).toBeNull(); // too short to be a song
  });
});
