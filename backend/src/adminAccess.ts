// Granting server admin (docs/api/server.md §10): only from the server's
// command line (src/cli/admin.ts), never through the API.
import { asc, eq } from "drizzle-orm";
import { users } from "@barista/shared/schema";
import { db } from "./db.js";

// True if the account exists (and now has the given access).
export async function setAdmin(email: string, isAdmin: boolean): Promise<boolean> {
  const [result] = await db.update(users).set({ isAdmin }).where(eq(users.email, email.trim().toLowerCase()));
  return result.affectedRows > 0;
}

export async function listAdmins(): Promise<string[]> {
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.isAdmin, true)).orderBy(asc(users.email));
  return rows.map((r) => r.email);
}
