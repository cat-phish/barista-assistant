// A workspace's flavor wheel (docs/api/flavor-lexicon.md §2c): its own
// lexicon if it has one, else the built-in wheel.
import { eq, inArray } from "drizzle-orm";
import { DEFAULT_LEXICON, LEXICON_FORMAT, LEXICON_VERSION, type FlavorLexicon } from "@barista/shared/flavors";
import { flavorLexicons } from "@barista/shared/schema";
import { db } from "./db.js";

type Conn = Pick<typeof db, "select">;

export interface WorkspaceLexicon {
  lexicon: FlavorLexicon;
  custom: boolean;
  updatedAt: Date | null; // when the custom one was imported
}

export async function workspaceLexicon(workspaceId: string, conn: Conn = db): Promise<WorkspaceLexicon> {
  const [row] = await conn.select().from(flavorLexicons).where(eq(flavorLexicons.workspaceId, workspaceId));
  if (!row) return { lexicon: DEFAULT_LEXICON, custom: false, updatedAt: null };
  return { lexicon: { format: LEXICON_FORMAT, version: LEXICON_VERSION, name: row.name, flavors: row.flavors }, custom: true, updatedAt: row.updatedAt };
}

// Several workspaces' lexicons at once (the built-in one for those without).
export async function lexiconsFor(workspaceIds: readonly string[]): Promise<Map<string, FlavorLexicon>> {
  const ids = [...new Set(workspaceIds)];
  const out = new Map<string, FlavorLexicon>(ids.map((id) => [id, DEFAULT_LEXICON]));
  if (ids.length === 0) return out;
  for (const row of await db.select().from(flavorLexicons).where(inArray(flavorLexicons.workspaceId, ids))) {
    out.set(row.workspaceId, { format: LEXICON_FORMAT, version: LEXICON_VERSION, name: row.name, flavors: row.flavors });
  }
  return out;
}
