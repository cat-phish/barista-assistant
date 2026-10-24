// Server admins, from the command line (docs/api/server.md §10):
//   docker compose exec backend npm run admin -- grant you@example.com
//   docker compose exec backend npm run admin -- revoke you@example.com
//   docker compose exec backend npm run admin -- list
// (in development: npx tsx src/cli/admin.ts …). The account must exist.
import "dotenv/config";
import { listAdmins, setAdmin } from "../adminAccess.js";
import { pool } from "../db.js";

async function main(args: string[]): Promise<number> {
  const [command, email] = args;
  if (command === "list") {
    const admins = await listAdmins();
    console.log(admins.length ? admins.join("\n") : "No server admins yet.");
    return 0;
  }
  if ((command === "grant" || command === "revoke") && email) {
    const found = await setAdmin(email, command === "grant");
    if (!found) {
      console.error(`No account with the email ${email}. Register it first.`);
      return 1;
    }
    console.log(command === "grant" ? `${email} is now a server admin.` : `${email} is no longer a server admin.`);
    return 0;
  }
  console.error("Usage: npm run admin -- grant <email> | revoke <email> | list");
  return 2;
}

main(process.argv.slice(2))
  .then((code) => (process.exitCode = code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
