// Scheduled server backups (docs/api/server.md §10): a whole-database dump,
// gzipped into the backup folder, keeping the newest N. The schedule and N
// are the admins' (server_settings "backups"); what happened is written to
// "backups_status" for Settings → Server.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { eq } from "drizzle-orm";
import { DB_BACKUP_FILE, dbBackupFileName } from "@barista/shared/jobs";
import { DEFAULT_BACKUP_SETTINGS, serverSettings, type BackupSettings, type BackupStatus } from "@barista/shared/schema";
import { config } from "./config.js";
import { db } from "./db.js";

// A running dump: its output, and when it ends (rejects if it failed).
export interface Dump {
  stdout: Readable;
  done: Promise<void>;
}
export type Dumper = () => Dump;

// mariadb-dump of the app's database, as the app's own user. The password
// goes in MYSQL_PWD, never on the command line (where `ps` would show it).
export function mariadbDump(): Dump {
  const url = new URL(config.database.url);
  const child = spawn(
    "mariadb-dump",
    ["--single-transaction", "--no-tablespaces", "-h", url.hostname, "-P", url.port || "3306", "-u", decodeURIComponent(url.username), url.pathname.slice(1)],
    { env: { ...process.env, MYSQL_PWD: config.database.password ?? decodeURIComponent(url.password) }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-2000)));
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", (err) => reject(new Error(`mariadb-dump couldn't start: ${err.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`mariadb-dump exited with ${code}: ${stderr.trim() || "no message"}`))));
  });
  return { stdout: child.stdout, done };
}

async function readSetting<T extends object>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select({ value: serverSettings.value }).from(serverSettings).where(eq(serverSettings.key, key));
  return row?.value && typeof row.value === "object" ? { ...fallback, ...(row.value as Partial<T>) } : { ...fallback };
}
async function writeStatus(status: BackupStatus): Promise<void> {
  await db.insert(serverSettings).values({ key: "backups_status", value: status }).onDuplicateKeyUpdate({ set: { value: status } });
}

// Deletes all but the newest `keep` dumps; other files are left alone.
export async function pruneBackups(dir: string, keep: number): Promise<string[]> {
  const dumps = (await readdir(dir)).filter((n) => DB_BACKUP_FILE.test(n)).sort().reverse();
  const old = dumps.slice(Math.max(1, keep));
  await Promise.all(old.map((n) => unlink(path.join(dir, n))));
  return old;
}

export interface BackupResult {
  file: string;
  bytes: number;
  pruned: string[];
}

export async function runDbBackup(options: { dir?: string; now?: Date; dump?: Dumper } = {}): Promise<BackupResult> {
  const dir = options.dir ?? process.env.BACKUP_DIR ?? "/backups";
  const now = options.now ?? new Date();
  const settings = await readSetting<BackupSettings>("backups", DEFAULT_BACKUP_SETTINGS);
  const previous = await readSetting<BackupStatus>("backups_status", { lastRunAt: null, lastFile: null, lastBytes: null, lastError: null });
  const file = dbBackupFileName(now);
  const partial = path.join(dir, `.${file}.partial`); // never listed: doesn't match DB_BACKUP_FILE
  try {
    await mkdir(dir, { recursive: true });
    const dump = (options.dump ?? mariadbDump)();
    // Both must finish: the file written, and the dump exited cleanly. Wait
    // for both either way, so a failed dump's file isn't still being written
    // when it's removed below.
    const [written, exited] = await Promise.allSettled([pipeline(dump.stdout, createGzip(), createWriteStream(partial)), dump.done]);
    if (exited.status === "rejected") throw exited.reason;
    if (written.status === "rejected") throw written.reason;
    await rename(partial, path.join(dir, file));
    const { size } = await stat(path.join(dir, file));
    const pruned = await pruneBackups(dir, settings.keep);
    await writeStatus({ lastRunAt: now.toISOString(), lastFile: file, lastBytes: size, lastError: null });
    return { file, bytes: size, pruned };
  } catch (err) {
    await unlink(partial).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    // The last good dump stays named; the error says this run failed.
    await writeStatus({ ...previous, lastRunAt: now.toISOString(), lastError: message });
    throw err;
  }
}
