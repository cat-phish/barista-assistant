// SEC-60 re-review (audit/diffs/REVIEW-safeUnzip.md): overlapping entries, the total cap, long names.
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { unzipBounded } from "../src/safeUnzip.js";

// A zip whose entries all point at the same compressed data (honest sizes per entry).
function overlapping(names: string[], originalSize: number, actual = originalSize): Buffer {
  const raw = deflateRawSync(Buffer.alloc(actual));
  const first = names[0]!;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(raw.length, 18);
  lh.writeUInt32LE(originalSize, 22);
  lh.writeUInt16LE(Buffer.byteLength(first), 26);
  const local = Buffer.concat([lh, Buffer.from(first), raw]);
  const dirs = names.map((name) => {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(raw.length, 20);
    cd.writeUInt32LE(originalSize, 24);
    cd.writeUInt16LE(Buffer.byteLength(name), 28);
    return Buffer.concat([cd, Buffer.from(name)]);
  });
  const dir = Buffer.concat(dirs);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, dir, end]);
}

describe("safeUnzip", () => {
  it("refuses entries that share the same data", async () => {
    const names = Array.from({ length: 20 }, (_, i) => `photos/${crypto.randomUUID()}-${i}.webp`);
    await expect(Promise.resolve().then(() => unzipBounded(overlapping(names, 1_000_000), () => true))).rejects.toThrow();
  });
  it("refuses more than 128 MB declared in total", async () => {
    // Declared sizes are cheap to forge; the cap must trip before anything is inflated.
    const names = ["a", "b", "c"].map((n) => `photos/${n}.webp`);
    await expect(Promise.resolve().then(() => unzipBounded(overlapping(names, 50 * 1024 * 1024, 1000), () => true))).rejects.toThrow(/too large unpacked/);
  });
  it("still unpacks a normal zip", async () => {
    const out = await unzipBounded(zipSync({ "a.txt": strToU8("hello"), "b.txt": strToU8("world") }), () => true);
    expect(Buffer.from(out["a.txt"]!).toString()).toBe("hello");
  });
  it("skips an entry with a very long name without unpacking it", async () => {
    const zip = zipSync({ [`photos/${"x".repeat(5000)}.webp`]: strToU8("junk"), "ok.txt": strToU8("fine") });
    const seen: string[] = [];
    const out = await unzipBounded(zip, (f) => (seen.push(f.name), true));
    expect(Object.keys(out)).toEqual(["ok.txt"]);
    expect(seen.every((n) => n.length < 600)).toBe(true);
  });

  // Extra cases from the re-review: malformed directories and forged headers.
  const eocdOf = (z: Uint8Array) => Buffer.from(z).lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cdOf = (z: Uint8Array) => Buffer.from(z).readUInt32LE(eocdOf(z) + 16);
  const patched = (z: Uint8Array, fn: (b: Buffer, cd: number) => void): Buffer => {
    const b = Buffer.from(z);
    fn(b, cdOf(z));
    return b;
  };
  const two = () => zipSync({ "a.txt": [strToU8("hello hello hello"), { level: 0 }], "b.txt": [strToU8("world world world"), { level: 0 }] });

  it("refuses duplicate entry names", async () => {
    const z = patched(two(), (b, cd) => {
      const second = cd + 46 + 5; // the second directory header (name "a.txt" is 5 bytes; no extra)
      b.write("a.txt", second + 46, "utf8");
    });
    await expect(unzipBounded(z, () => true)).rejects.toThrow(/duplicate entry/);
  });
  it("refuses a stored entry whose two sizes disagree", async () => {
    const z = patched(two(), (b, cd) => b.writeUInt32LE(3, cd + 24)); // original 3, stored 17
    await expect(unzipBounded(z, () => true)).rejects.toThrow(/size mismatch/);
  });
  it("refuses an encrypted entry it would unpack", async () => {
    const z = patched(two(), (b, cd) => b.writeUInt16LE(1, cd + 8));
    await expect(unzipBounded(z, () => true)).rejects.toThrow(/encrypted/);
  });
  it("refuses a compression method other than stored or deflate", async () => {
    const z = patched(two(), (b, cd) => b.writeUInt16LE(12, cd + 10));
    await expect(unzipBounded(z, () => true)).rejects.toThrow(/unsupported compression/);
  });
  it("does not refuse an encrypted or odd entry the caller skips", async () => {
    const z = patched(two(), (b, cd) => b.writeUInt16LE(1, cd + 8));
    const out = await unzipBounded(z, (f) => f.name === "b.txt");
    expect(Object.keys(out)).toEqual(["b.txt"]);
  });
  it("rejects a local header offset past the end", async () => {
    const z = patched(two(), (b, cd) => b.writeUInt32LE(b.length + 100, cd + 42));
    await expect(unzipBounded(z, () => true)).rejects.toThrow(/Not a zip/);
  });
  it("rejects a truncated central directory", async () => {
    const z = two();
    const b = Buffer.from(z);
    const cut = Buffer.concat([b.subarray(0, cdOf(z) + 20), b.subarray(eocdOf(z))]);
    cut.writeUInt32LE(cdOf(z), cut.length - 22 + 16);
    await expect(unzipBounded(cut, () => true)).rejects.toThrow();
  });
  it("rejects data with no end-of-directory record", async () => {
    await expect(unzipBounded(Buffer.from("not a zip at all, just text"), () => true)).rejects.toThrow(/Not a zip/);
  });
  it("ignores an end-of-directory signature hidden in the zip comment", async () => {
    const z = Buffer.from(two());
    const fake = Buffer.alloc(22);
    fake.writeUInt32LE(0x06054b50, 0); // a record with zero entries, planted in the comment
    const real = Buffer.from(z);
    real.writeUInt16LE(fake.length, real.length - 2); // comment length
    const out = await unzipBounded(Buffer.concat([real, fake]), () => true);
    // The last signature wins, so the planted empty record is what is read: nothing is unpacked, nothing breaks.
    expect(Object.keys(out)).toEqual([]);
  });
  it("accepts a JSON entry exactly at its size cap and skips one byte over", async () => {
    const cap = 1024;
    const zip = zipSync({ "chats.json": [new Uint8Array(cap), { level: 0 }], "big.json": [new Uint8Array(cap + 1), { level: 0 }] });
    const out = await unzipBounded(zip, (f) => f.originalSize <= cap);
    expect(Object.keys(out)).toEqual(["chats.json"]);
  });
});
