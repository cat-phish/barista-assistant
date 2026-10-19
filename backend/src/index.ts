import "dotenv/config";
import { app } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { closeQueue } from "./queue.js";

const server = app.listen(config.port, () => {
  console.log(`Backend listening on port ${config.port}`);
});

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
