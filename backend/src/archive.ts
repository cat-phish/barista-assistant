import { sql } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";

// PATCH "archived": true sets archivedAt (keeping the first date if it's
// already archived), false restores; absent leaves it (docs/api/beans.md §4).
export function archiveUpdate(column: MySqlColumn, archived: boolean | undefined) {
  if (archived === true) return { archivedAt: sql`COALESCE(${column}, NOW())` };
  if (archived === false) return { archivedAt: null };
  return {};
}
