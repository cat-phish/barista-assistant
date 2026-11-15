// Security audit session 4: SEC-50 (SSRF), SEC-60 (zip bomb), SEC-61 (restore quota),
// SEC-82 (AI budget), SEC-90 (image bomb). Each case fails until its fix lands.
import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { processPhoto } from "../src/photos.js";
import { readBackupZip } from "../src/backupZip.js";
import { brewerId, newBean, newUser, newWorkspace } from "./helpers.js";

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
  it("rejects a zip with more than 1,000 photo entries", () => {
    const files: Record<string, Uint8Array> = { "backup.json": strToU8("{}") };
    for (let i = 0; i < 1500; i++) files[`photos/${crypto.randomUUID()}.webp`] = new Uint8Array(8);
    const res = readBackupZip(Buffer.from(zipSync(files)));
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
