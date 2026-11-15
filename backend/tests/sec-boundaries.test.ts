// Security audit session 4: SEC-50 (SSRF), SEC-60 (zip bomb), SEC-61 (restore quota),
// SEC-82 (AI budget), SEC-90 (image bomb). Each case fails until its fix lands.
import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { processPhoto } from "../src/photos.js";
import { readBackupZip } from "../src/backupZip.js";
import { brewerId, newBean, newUser, newWorkspace } from "./helpers.js";

// The real caps (tests/setup.ts raises them for every other file).
vi.hoisted(() => {
  process.env.HEAVY_IMPORT_LIMIT_PER_HOUR = "10";
  process.env.AI_DAILY_USER_UNITS = "100";
});

afterEach(() => vi.unstubAllGlobals());

const NOTIFY = "/api/auth/me/notifications";

describe("SEC-50 notification URLs reach internal hosts", () => {
  const targets = [
    "http://169.254.169.254/latest/api/token",
    "http://127.0.0.1:3000/health",
    "http://[::1]:3000/",
    "http://2130706433/",
    "http://host.docker.internal:8080/",
    "http://redis:6379/",
  ];
  for (const url of targets) {
    it(`refuses ${url} when saving a webhook`, async () => {
      const me = await newUser();
      const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);
      const res = await me.agent.put(`${NOTIFY}/webhook`).send({ config: { url } });
      expect(res.status).toBe(400);
      await me.agent.post(`${NOTIFY}/webhook/test`);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }
});

describe("SEC-60 zip restore has no bounds", () => {
  it("rejects a zip with more than 3,000 photo entries", async () => {
    const files: Record<string, Uint8Array> = { "backup.json": strToU8("{}") };
    for (let i = 0; i < 3500; i++) files[`photos/${crypto.randomUUID()}.webp`] = new Uint8Array(8);
    const res = await readBackupZip(Buffer.from(zipSync(files)));
    expect(res.ok).toBe(false);
  });
});

describe("SEC-61 restore has no per-account quota", () => {
  it("stops a fresh user restoring 30 workspaces in a row", async () => {
    const user = await newUser();
    const ws = await newWorkspace(user);
    const backup = await user.agent.get(`/api/workspaces/${ws.id}/backup`);
    expect(backup.status).toBe(200);
    let refused = false;
    for (let i = 0; i < 30 && !refused; i++) {
      const res = await user.agent.post("/api/workspaces/restore").send({ name: `Copy${i}`, slug: `quota-${ws.slug}-${i}`, backup: backup.body });
      expect([201, 409, 413, 429], `restore ${i}: ${res.status} ${JSON.stringify(res.body)}`).toContain(res.status);
      if (res.status === 429 || res.status === 409 || res.status === 413) refused = true;
    }
    expect(refused).toBe(true);
  });
});

describe("SEC-82 AI calls have no budget", () => {
  it("answers 429 before the 51st suggest-parameters request in a day", async () => {
    const owner = await newUser();
    const ws = (await newWorkspace(owner)).id;
    const v60 = await brewerId(owner, ws, "V60");
    const bean = await newBean(owner, ws);
    const recipe = (await owner.agent.post(`/api/workspaces/${ws}/recipes`).send({ name: "House", brewerId: v60, targetDoseGrams: 15, targetWaterGrams: 250 })).body.recipe.id as string;
    const statuses: number[] = [];
    for (let i = 0; i < 51; i++) {
      statuses.push((await owner.agent.post(`/api/workspaces/${ws}/parameter-suggestions`).send({ beanId: bean, recipeId: recipe })).status);
    }
    expect(statuses).toContain(429);
  });
});

describe("SEC-90 image decode has no pixel cap", () => {
  it("processPhoto refuses a 16000 x 16000 image", async () => {
    const big = await sharp(Buffer.alloc(16000 * 16000), { raw: { width: 16000, height: 16000, channels: 1 } }).png({ compressionLevel: 9 }).toBuffer();
    expect(await processPhoto(big)).toBeNull();
  }, 60_000);
});

// SEC-60 (review): an entry that declares 1 MB but inflates to 200 MB is cut off, not inflated.
describe("SEC-60 lying zip entry", () => {
  it("refuses a photo entry whose stream is far bigger than it declares", async () => {
    const { deflateRawSync } = await import("node:zlib");
    const raw = deflateRawSync(Buffer.alloc(200 * 1024 * 1024));
    const name = Buffer.from(`photos/${crypto.randomUUID()}.webp`);
    const declared = 1024 * 1024;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(declared, 22); lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(raw.length, 20); cd.writeUInt32LE(declared, 24); cd.writeUInt16LE(name.length, 28);
    const local = Buffer.concat([lh, name, raw]);
    const dir = Buffer.concat([cd, name]);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(local.length, 16);
    const t = Date.now();
    const res = await readBackupZip(Buffer.concat([local, dir, end]));
    expect(res.ok).toBe(false);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
