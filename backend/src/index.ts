import "dotenv/config";
import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { closeQueue, syncBackupSchedule } from "./queue.js";
import { getBackupSettings } from "./serverSettings.js";
import { sweepOrphanPhotos } from "./photos.js";

const server = app.listen(config.port, () => {
  console.log(`Backend listening on port ${config.port}`);
});

// Photo files whose rows are gone (docs/api/bean-photos.md §4c).
sweepOrphanPhotos()
  .then((n) => n > 0 && console.log(`Removed ${n} orphaned photo file(s)`))
  .catch((err: unknown) => console.error("Photo sweep failed:", err instanceof Error ? err.message : err));

// The backup schedule follows the saved settings (docs/api/server.md §10),
// also after a change of BACKUP_TIMEZONE or a lost Redis.
getBackupSettings()
  .then(syncBackupSchedule)
  .catch((err: unknown) => console.error("Backup schedule not synced:", err instanceof Error ? err.message : err));

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    Promise.allSettled([pool.end(), closeQueue()])
      .then((results) => {
        for (const r of results) {
          if (r.status === "rejected") console.error("Error during shutdown:", r.reason);
        }
      })
      .finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
