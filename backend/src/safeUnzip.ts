// Bounded unzip for uploaded zips (SEC-60). fflate's filter sees every
// central-directory entry before anything is inflated, so the checks here
// refuse a zip bomb (thousands of entries, duplicate names, lying sizes)
// without unpacking a byte of it.
import { unzipSync, type UnzipFileInfo } from "fflate";

const MAX_ENTRIES = 1100; // the JSON plus up to ~1,000 photos and logos
const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // declared size of everything accepted
const MAX_EXPAND_SLACK = 1024; // a stored/deflated entry may not be bigger than its original by more than this

class ZipRefused extends Error {}

export function unzipBounded(data: Uint8Array, accept: (f: UnzipFileInfo) => boolean): Record<string, Uint8Array> {
  const seen = new Set<string>();
  let entries = 0;
  let total = 0;
  try {
    return unzipSync(data, {
      filter: (f) => {
        if (++entries > MAX_ENTRIES) throw new ZipRefused("too many entries");
        if (seen.has(f.name)) throw new ZipRefused("duplicate entry");
        seen.add(f.name);
        if (f.size > f.originalSize + MAX_EXPAND_SLACK) throw new ZipRefused("size mismatch");
        if (!accept(f)) return false;
        total += f.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new ZipRefused("too large unpacked");
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ZipRefused) throw err;
    throw new Error("Not a zip file that can be read");
  }
}
