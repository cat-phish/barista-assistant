// Bounded unzip for uploaded zips (SEC-60). The central directory is read
// by hand so nothing is inflated until every entry has passed the checks,
// and each entry is inflated with zlib's output cap set to its declared
// size, so a stream that lies about its size is cut off instead of being
// inflated in full on the event loop.
import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";

const inflateRawAsync = promisify(inflateRaw);

const MAX_ENTRIES = 10_000; // headers in the zip, accepted or not
const MAX_ACCEPTED = 3000; // entries actually unpacked (photos, logos, the JSON)
const MAX_TOTAL_BYTES = 128 * 1024 * 1024; // declared size of everything accepted
const MAX_NAME_BYTES = 512; // longer names are skipped before they are decoded
const MAX_EXPAND_SLACK = 1024; // a stored size may not exceed the original by more than this

export interface ZipEntryInfo {
  name: string;
  size: number; // stored (compressed) size
  originalSize: number;
}

const refuse = (why: string): never => {
  throw new Error(`The zip is not acceptable (${why})`);
};

// Inflating runs on the thread pool, so a big upload doesn't stop other requests.
export async function unzipBounded(data: Uint8Array, accept: (f: ZipEntryInfo) => boolean): Promise<Record<string, Uint8Array>> {
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
    const nameAt = pos + 46;
    pos += 46 + nameLen + extraLen + commentLen;
    if (size === 0xffffffff || originalSize === 0xffffffff || offset === 0xffffffff) refuse("zip64 is not supported");
    if (nameLen > MAX_NAME_BYTES) continue; // no entry the app reads has a name this long
    const name = buf.toString("utf8", nameAt, nameAt + nameLen);
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

  // Where each entry's data lies; two entries may not share bytes, or a few KB
  // of zip could be unpacked many times over.
  const located = accepted.map((e) => {
    if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error("Not a zip file that can be read");
    const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
    if (start + e.size > buf.length) throw new Error("Not a zip file that can be read");
    return { ...e, headerAt: e.offset, start };
  });
  located.sort((a, b) => a.headerAt - b.headerAt);
  for (let i = 1; i < located.length; i++) if (located[i]!.headerAt < located[i - 1]!.start + located[i - 1]!.size) refuse("entries overlap");

  const out: Record<string, Uint8Array> = {};
  for (const e of located) {
    const start = e.start;
    const raw = buf.subarray(start, start + e.size);
    let bytes: Buffer;
    if (e.method === 0) {
      if (e.size !== e.originalSize) refuse("size mismatch");
      bytes = Buffer.from(raw);
    } else {
      try {
        bytes = await inflateRawAsync(raw, { maxOutputLength: Math.max(1, e.originalSize) });
      } catch {
        return refuse("an entry is bigger than it says");
      }
      if (bytes.length !== e.originalSize) refuse("size mismatch");
    }
    out[e.name] = bytes;
  }
  return out;
}
