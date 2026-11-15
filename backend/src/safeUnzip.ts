// Bounded unzip for uploaded zips (SEC-60). The central directory is read
// by hand so nothing is inflated until every entry has passed the checks,
// and each entry is inflated with zlib's output cap set to its declared
// size, so a stream that lies about its size is cut off instead of being
// inflated in full on the event loop.
import { inflateRawSync } from "node:zlib";

const MAX_ENTRIES = 10_000; // headers in the zip, accepted or not
const MAX_ACCEPTED = 3000; // entries actually unpacked (photos, logos, the JSON)
const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // declared size of everything accepted
const MAX_EXPAND_SLACK = 1024; // a stored size may not exceed the original by more than this

export interface ZipEntryInfo {
  name: string;
  size: number; // stored (compressed) size
  originalSize: number;
}

const refuse = (why: string): never => {
  throw new Error(`The zip is not acceptable (${why})`);
};

export function unzipBounded(data: Uint8Array, accept: (f: ZipEntryInfo) => boolean): Record<string, Uint8Array> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  // End of central directory record: last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file that can be read");
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) refuse("too many entries");
  if (count === 0xffff || pos === 0xffffffff) refuse("zip64 is not supported");

  const seen = new Set<string>();
  const accepted: Array<{ name: string; offset: number; method: number; size: number; originalSize: number }> = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new Error("Not a zip file that can be read");
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const size = buf.readUInt32LE(pos + 20);
    const originalSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const offset = buf.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen > buf.length) throw new Error("Not a zip file that can be read");
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;
    if (size === 0xffffffff || originalSize === 0xffffffff || offset === 0xffffffff) refuse("zip64 is not supported");
    if (seen.has(name)) refuse("duplicate entry");
    seen.add(name);
    if (size > originalSize + MAX_EXPAND_SLACK) refuse("size mismatch");
    if (!accept({ name, size, originalSize })) continue;
    if (flags & 1) refuse("encrypted entry");
    if (method !== 0 && method !== 8) refuse("unsupported compression");
    if (accepted.length >= MAX_ACCEPTED) refuse("too many files");
    total += originalSize;
    if (total > MAX_TOTAL_BYTES) refuse("too large unpacked");
    accepted.push({ name, offset, method, size, originalSize });
  }

  const out: Record<string, Uint8Array> = {};
  for (const e of accepted) {
    if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("Not a zip file that can be read");
    const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
    if (start + e.size > buf.length) throw new Error("Not a zip file that can be read");
    const raw = buf.subarray(start, start + e.size);
    let bytes: Buffer;
    if (e.method === 0) {
      if (e.size !== e.originalSize) refuse("size mismatch");
      bytes = Buffer.from(raw);
    } else {
      try {
        bytes = inflateRawSync(raw, { maxOutputLength: Math.max(1, e.originalSize) });
      } catch {
        return refuse("an entry is bigger than it says");
      }
      if (bytes.length !== e.originalSize) refuse("size mismatch");
    }
    out[e.name] = bytes;
  }
  return out;
}
