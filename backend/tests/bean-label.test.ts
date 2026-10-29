import { LABEL_READ_QUEUE, type LabelFields, type LabelReadJobData, type LabelReadResult } from "@barista/shared/jobs";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { addMember, newUser, newWorkspace } from "./helpers.js";

// Reading a bean label (docs/api/bean-label.md §4d). The real worker isn't
// running here: a stand-in answers, and keeps the job it got.
const FIELDS: LabelFields = {
  roasterName: "Onyx",
  beanName: "Geometry",
  processName: "Washed",
  processText: null,
  country: "Ethiopia",
  region: null,
  producer: null,
  altitudeMasl: 2000,
  flavorProfile: null,
  roastDate: null,
  detailedRoastLevel: null,
  roastLevel: null,
  roastType: null,
  blendType: null,
  decaf: null,
  bagWeightGrams: 340,
  batchNumber: null,
  website: null,
};
const WEB = { producer: { value: "Many farms", url: "https://onyxcoffeelab.com/geometry" } };
let worker: Worker<LabelReadJobData, LabelReadResult> | null = null;
let connection: Redis | null = null;
let received: LabelReadJobData | null = null;
function startWorker(fail = false): void {
  connection = new Redis(process.env.REDIS_URL ?? "", { password: process.env.REDIS_PASSWORD, maxRetriesPerRequest: null });
  worker = new Worker<LabelReadJobData, LabelReadResult>(
    LABEL_READ_QUEUE,
    async (job) => {
      received = job.data;
      if (fail) throw new Error("model can't see");
      return job.data.lookUp
        ? { fields: job.data.lookUp, web: WEB, webSources: [WEB.producer.url], webError: null }
        : { fields: FIELDS, web: null, webSources: [], webError: null };
    },
    { connection },
  );
}
afterEach(async () => {
  await worker?.close();
  connection?.disconnect();
  worker = null;
  received = null;
  delete process.env.LABEL_READ_TIMEOUT_MS;
  delete process.env.LABEL_WEB_TIMEOUT_MS;
});

const jpeg = async (width: number, height: number) =>
  (await sharp({ create: { width, height, channels: 3, background: "#8b5a2b" } }).jpeg().toBuffer()).toString("base64");

describe("reading a bean label from photos", () => {
  it("re-encodes the photos and sends the workspace's processes", async () => {
    startWorker();
    const owner = await newUser();
    const ws = (await newWorkspace(owner)).id;
    const res = await owner.agent.post(`/api/workspaces/${ws}/bean-label`).send({ images: [await jpeg(2000, 1500), await jpeg(300, 400)] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ fields: FIELDS, web: null, webSources: [], webError: null });
    expect(received!.lookUp).toBeUndefined();
    expect(received!.images).toHaveLength(2);
    const first = await sharp(Buffer.from(received!.images[0]!, "base64")).metadata();
    expect([first.format, first.width, first.height]).toEqual(["webp", 1024, 768]);
    expect(received!.processes).toContain("Washed");
    expect(received!.processes).toContain("Natural");
    expect(received!.requestedBy).toBe(owner.id); // their AI prompt is used
    // Up to 8: the bean's 6 and a couple taken just for the read.
    expect((await owner.agent.post(`/api/workspaces/${ws}/bean-label`).send({ images: Array(8).fill(await jpeg(20, 20)) })).status).toBe(200);
  });

  it("checks the photos", async () => {
    const owner = await newUser();
    const ws = (await newWorkspace(owner)).id;
    const url = `/api/workspaces/${ws}/bean-label`;
    const one = await jpeg(10, 10);
    expect((await owner.agent.post(url).send({ images: [] })).status).toBe(400);
    expect((await owner.agent.post(url).send({ images: Array(9).fill(one) })).status).toBe(400); // LABEL_MAX_IMAGES
    expect((await owner.agent.post(url).send({ images: ["not base64!"] })).status).toBe(400);
    const notImage = await owner.agent.post(url).send({ images: [one, Buffer.from("hello").toString("base64")] });
    expect(notImage.status).toBe(400);
    expect(notImage.body.error).toMatch(/Photo 2/);
  });

  it("is for who can edit beans, when the workspace allows it", async () => {
    const owner = await newUser();
    const viewer = await newUser();
    const ws = (await newWorkspace(owner)).id;
    await addMember(owner, ws, viewer, "viewer");
    const url = `/api/workspaces/${ws}/bean-label`;
    const body = { images: [await jpeg(10, 10)] };
    expect((await viewer.agent.post(url).send(body)).status).toBe(403);
    expect((await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ readLabels: false })).status).toBe(200);
    const off = await owner.agent.post(url).send(body);
    expect(off.status).toBe(403);
    expect(off.body.error).toMatch(/turned off/);
  });

  it("502 when the read fails; 504 when nobody answers", async () => {
    const owner = await newUser();
    const ws = (await newWorkspace(owner)).id;
    const url = `/api/workspaces/${ws}/bean-label`;
    const body = { images: [await jpeg(10, 10)] };
    startWorker(true);
    expect((await owner.agent.post(url).send(body)).status).toBe(502);
    await worker!.close();
    process.env.LABEL_READ_TIMEOUT_MS = "300";
    const res = await owner.agent.post(url).send(body);
    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/in time/);
  });
  it("looks it up on the web on its own, when the workspace allows it", async () => {
    const owner = await newUser();
    const ws = (await newWorkspace(owner)).id;
    const url = `/api/workspaces/${ws}/bean-label/web`;
    const body = { fields: { roasterName: "Onyx", beanName: " Geometry ", region: "", altitudeMasl: 2000, website: "onyxcoffeelab.com" } };
    const off = await owner.agent.post(url).send(body);
    expect(off.status).toBe(403);
    expect(off.body.error).toMatch(/web is turned off/);
    await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ labelWebLookup: true });
    startWorker();
    const res = await owner.agent.post(url).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ web: WEB, webSources: [WEB.producer.url], webError: null });
    // What's known, the rest null; no photos.
    expect(received).toMatchObject({ images: [], webContext: "high", requestedBy: owner.id });
    expect(received!.lookUp).toMatchObject({ roasterName: "Onyx", beanName: "Geometry", region: null, altitudeMasl: 2000, website: "onyxcoffeelab.com", roastDate: null, batchNumber: null });
    await owner.agent.patch(`/api/workspaces/${ws}/settings`).send({ labelWebContext: "medium" });
    await owner.agent.post(url).send(body);
    expect(received!.webContext).toBe("medium");
    // A name to look for; nothing that belongs to one bag.
    expect((await owner.agent.post(url).send({ fields: { country: "Ethiopia" } })).status).toBe(400);
    expect((await owner.agent.post(url).send({ fields: { beanName: "Geometry", roastDate: "2026-10-01" } })).status).toBe(400);
    // It waits longer than a label read.
    await worker!.close();
    process.env.LABEL_READ_TIMEOUT_MS = "100";
    process.env.LABEL_WEB_TIMEOUT_MS = "400";
    const started = Date.now();
    const late = await owner.agent.post(url).send(body);
    expect(late.status).toBe(504);
    expect(late.body.error).toMatch(/web lookup/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  });

  it("no longer takes web with the photos", async () => {
    const owner = await newUser();
    const ws = (await newWorkspace(owner)).id;
    const res = await owner.agent.post(`/api/workspaces/${ws}/bean-label`).send({ images: [await jpeg(10, 10)], web: true });
    expect(res.status).toBe(400);
  });
});
