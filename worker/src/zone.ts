import { eq } from "drizzle-orm";
import { workspaces, type WorkspaceSettings } from "@barista/shared/schema";
import { config } from "./config.js";
import { db } from "./db.js";

// A workspace's time zone (docs/api/workspaces.md §2, timeZone): its own
// setting, else the server's BREW_TIMEZONE, else null (UTC). For brews
// logged without a UTC offset, and today's date in a suggestion.
export function settingsZone(settings: Partial<WorkspaceSettings> | null | undefined): string | null {
  return settings?.timeZone ?? config.brewTimezone;
}

export async function workspaceZone(workspaceId: string): Promise<string | null> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return settingsZone(ws?.settings);
}
