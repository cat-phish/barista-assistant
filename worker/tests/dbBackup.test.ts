import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { dbBackupFileName } from "@barista/shared/jobs";
import { serverSettings } from "@barista/shared/schema";
import { db } from "../src/db.js";
import { runDbBackup, type Dumper } from "../src/dbBackup.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "barista-dumps-"));
});

const fakeDump = (text: string): Dumper => () => ({ stdout: Readable.from([text]), done: Promise.resolve() });
const status = async () => (await db.select().from(serverSettings).where(eq(serverSettings.key, "backups_status")))[0]?.value;

describe("scheduled database dumps (docs/api/server.md §10)", () => {
  it("gzips the dump under a dated name and keeps only the newest N", async () => {
    await db.insert(serverSettings).values({ key: "backups", value: { frequency: "daily", hour: 3, weekday: 0, keep: 2 } });
    await writeFile(path.join(dir, "keep-me.txt"), "not a dump");
    const days = ["2026-10-20", "2026-10-21", "2026-10-22"];
    for (const d of days) await runDbBackup({ dir, now: new Date(`${d}T03:00:00Z`), dump: fakeDump(`-- dump of ${d}\n`) });

    const files = (await readdir(dir)).sort();
    expect(files).toEqual([dbBackupFileName(new Date("2026-10-21T03:00:00Z")), dbBackupFileName(new Date("2026-10-22T03:00:00Z")), "keep-me.txt"]);
    const newest = path.join(dir, dbBackupFileName(new Date("2026-10-22T03:00:00Z")));
    expect(gunzipSync(await readFile(newest)).toString()).toBe("-- dump of 2026-10-22\n");
    expect(await status()).toMatchObject({ lastRunAt: "2026-10-22T03:00:00.000Z", lastFile: "barista-db-2026-10-22-0300Z.sql.gz", lastError: null });
  });

  it("records a failed dump and leaves no partial file behind", async () => {
    await runDbBackup({ dir, now: new Date("2026-10-20T03:00:00Z"), dump: fakeDump("-- good\n") });
    const failing: Dumper = () => ({ stdout: Readable.from(["-- half a dump"]), done: Promise.reject(new Error("mariadb-dump exited with 2: Access denied")) });
    await expect(runDbBackup({ dir, now: new Date("2026-10-21T03:00:00Z"), dump: failing })).rejects.toThrow(/Access denied/);
    expect(await readdir(dir)).toEqual(["barista-db-2026-10-20-0300Z.sql.gz"]);
    // The last good dump is still named; the error says this run failed.
    expect(await status()).toMatchObject({ lastRunAt: "2026-10-21T03:00:00.000Z", lastFile: "barista-db-2026-10-20-0300Z.sql.gz", lastError: "mariadb-dump exited with 2: Access denied" });
  });
});
