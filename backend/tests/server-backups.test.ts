import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupCron, DB_BACKUP_JOB, DB_BACKUP_SCHEDULER, dbBackupFileName } from "@barista/shared/jobs";
import { listAdmins, setAdmin } from "../src/adminAccess.js";
import { maintenanceQueue } from "../src/queue.js";
import { anonymous, newUser, type TestUser } from "./helpers.js";

const BASE = "/api/server/backups";
let dir: string;
let admin: TestUser;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "barista-backups-"));
  process.env.BACKUP_DIR = dir;
  admin = await newUser();
  expect(await setAdmin(` ${admin.email.toUpperCase()} `, true)).toBe(true);
});
afterEach(() => {
  delete process.env.BACKUP_DIR;
  delete process.env.BACKUP_TIMEZONE;
  delete process.env.BACKUP_DOWNLOADS;
  delete process.env.ALLOW_REGISTRATION;
});

describe("server backups (docs/api/server.md §10)", () => {
  it("are for server admins only, and /me says who is one", async () => {
    const someone = await newUser();
    expect((await someone.agent.get(BASE)).status).toBe(403);
    expect((await someone.agent.put(`${BASE}/settings`).send({ frequency: "daily", hour: 3, weekday: 0, keep: 7 })).status).toBe(403);
    expect((await someone.agent.post(`${BASE}/run`)).status).toBe(403);
    expect((await someone.agent.get("/api/auth/me")).body.user.isAdmin).toBe(false);
    expect((await admin.agent.get("/api/auth/me")).body.user.isAdmin).toBe(true);
  });

  it("start off, then follow the saved schedule in the chosen zone", async () => {
    process.env.BACKUP_TIMEZONE = "America/Los_Angeles";
    const first = await admin.agent.get(BASE);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ settings: { frequency: "off", hour: 3, weekday: 0, keep: 7 }, timezone: "America/Los_Angeles", nextRunAt: null, files: [] });
    expect(first.body.status).toEqual({ lastRunAt: null, lastFile: null, lastBytes: null, lastError: null });

    const weekly = await admin.agent.put(`${BASE}/settings`).send({ frequency: "weekly", hour: 4, weekday: 1, keep: 4 });
    expect(weekly.status).toBe(200);
    expect(weekly.body.settings).toEqual({ frequency: "weekly", hour: 4, weekday: 1, keep: 4 });
    expect(weekly.body.nextRunAt).toEqual(expect.any(String));
    const scheduler = await maintenanceQueue.getJobScheduler(DB_BACKUP_SCHEDULER);
    expect(scheduler).toMatchObject({ pattern: "0 4 * * 1", tz: "America/Los_Angeles", name: DB_BACKUP_JOB });

    const off = await admin.agent.put(`${BASE}/settings`).send({ frequency: "off", hour: 4, weekday: 1, keep: 4 });
    expect(off.body.nextRunAt).toBeNull();
    expect(await maintenanceQueue.getJobScheduler(DB_BACKUP_SCHEDULER)).toBeUndefined();
    expect((await admin.agent.get(BASE)).body.settings.keep).toBe(4); // saved

    for (const bad of [{ frequency: "hourly", hour: 3, weekday: 0, keep: 7 }, { frequency: "daily", hour: 24, weekday: 0, keep: 7 }, { frequency: "daily", hour: 3, weekday: 0, keep: 0 }, { frequency: "daily" }]) {
      expect((await admin.agent.put(`${BASE}/settings`).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("queues a dump on demand", async () => {
    expect((await admin.agent.post(`${BASE}/run`)).status).toBe(202);
    const jobs = await maintenanceQueue.getJobs(["waiting", "delayed", "active"]);
    expect(jobs.map((j) => [j.name, j.data])).toContainEqual([DB_BACKUP_JOB, { reason: "manual" }]);
  });

  it("lists and serves only dump files, newest first", async () => {
    const older = dbBackupFileName(new Date("2026-10-22T03:00:00Z"));
    const newer = dbBackupFileName(new Date("2026-10-23T03:00:00Z"));
    await writeFile(path.join(dir, older), "older");
    await writeFile(path.join(dir, newer), "newer!");
    await writeFile(path.join(dir, "notes.txt"), "not a dump");
    const files = (await admin.agent.get(BASE)).body.files as Array<{ name: string; bytes: number }>;
    expect(files.map((f) => [f.name, f.bytes])).toEqual([
      [newer, 6],
      [older, 5],
    ]);
    const fetchFile = (name: string, password = admin.password) =>
      admin.agent
        .post(`${BASE}/files/${name}`)
        .send({ password })
        .buffer(true)
        .parse((res, done) => {
          let body = "";
          res.on("data", (c: Buffer) => (body += c.toString()));
          res.on("end", () => done(null, body));
        });
    const download = await fetchFile(newer);
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain(newer);
    expect(download.body).toBe("newer!");
    // The password again, every time: a session alone isn't enough.
    expect((await fetchFile(newer, "not-my-password")).status).toBe(401);
    expect((await admin.agent.post(`${BASE}/files/${newer}`).send({})).status).toBe(400);
    expect((await fetchFile("notes.txt")).status).toBe(404);
    expect((await fetchFile("..%2F..%2Fetc%2Fpasswd")).status).toBe(404);
    expect((await fetchFile(dbBackupFileName(new Date("2020-01-01T00:00:00Z")))).status).toBe(404);
    expect((await admin.agent.get(`${BASE}/files/${newer}`)).status).toBe(404); // no GET

    // Turned off: they stay on the server.
    process.env.BACKUP_DOWNLOADS = "false";
    expect((await admin.agent.get(BASE)).body.downloadsEnabled).toBe(false);
    expect((await fetchFile(newer)).status).toBe(403);
  });
});

describe("who is a server admin (docs/api/server.md §10)", () => {
  it("only the server grants it: not by registering, not through the API", async () => {
    const someone = await newUser();
    expect(await listAdmins()).toEqual([admin.email]);
    expect((await someone.agent.patch("/api/auth/me/preferences").send({ isAdmin: true })).status).toBe(400);
    expect((await someone.agent.get("/api/auth/me")).body.user.isAdmin).toBe(false);
    expect(await setAdmin("nobody@example.com", true)).toBe(false); // the account must exist
    expect(await setAdmin(admin.email, false)).toBe(true);
    expect((await admin.agent.get(BASE)).status).toBe(403); // takes effect at once
  });
});

describe("closing registration (docs/api/auth.md §1)", () => {
  it("refuses new accounts but keeps signing in", async () => {
    const guest = anonymous();
    expect((await guest.get("/api/auth/registration")).body).toEqual({ open: true });
    process.env.ALLOW_REGISTRATION = "false";
    expect((await guest.get("/api/auth/registration")).body).toEqual({ open: false });
    const refused = await guest.post("/api/auth/register").send({ email: "late@example.com", password: "long-enough-password" });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/closed/);
    expect((await guest.post("/api/auth/login").send({ email: admin.email, password: admin.password })).status).toBe(200);
  });
});

describe("backup schedule and file names", () => {
  it("turn settings into a cron pattern and a dated name", () => {
    expect(backupCron({ frequency: "off", hour: 3, weekday: 0 })).toBeNull();
    expect(backupCron({ frequency: "daily", hour: 3, weekday: 5 })).toBe("0 3 * * *");
    expect(backupCron({ frequency: "weekly", hour: 23, weekday: 6 })).toBe("0 23 * * 6");
    expect(dbBackupFileName(new Date("2026-10-24T03:07:09Z"))).toBe("barista-db-2026-10-24-0307Z.sql.gz");
  });
});
