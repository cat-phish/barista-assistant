// The type of an uploaded song from its own first bytes (docs/api/auth.md §1,
// "Year song"), never from its name or Content-Type. null: not audio we play.
export type SongMime = "audio/mpeg" | "audio/aac" | "audio/mp4" | "audio/ogg" | "audio/webm" | "audio/flac" | "audio/wav";

const MP4_BRANDS = new Set(["M4A ", "M4B ", "mp41", "mp42", "isom", "iso2", "dash"]);

const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString("latin1");

export function sniffAudio(b: Buffer): SongMime | null {
  if (b.length < 12) return null;
  if (ascii(b, 0, 3) === "ID3") return "audio/mpeg";
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) {
    const layer = (b[1]! >> 1) & 3; // 0 = AAC in ADTS, else MPEG layer III/II/I
    return layer === 0 ? "audio/aac" : "audio/mpeg";
  }
  if (ascii(b, 4, 8) === "ftyp" && MP4_BRANDS.has(ascii(b, 8, 12))) return "audio/mp4";
  if (ascii(b, 0, 4) === "OggS") return "audio/ogg";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (ascii(b, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return "audio/wav";
  return null;
}
