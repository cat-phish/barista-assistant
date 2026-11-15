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
});
