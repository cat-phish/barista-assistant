// Flavor-wheel picks on a brew (docs/api/brew-logs.md §6) or a serving
// (docs/api/brew-servings.md §6c): the same rules for both, whichever table
// stores them.
import { flavorPlace, resolvePicks, type FlavorPick } from "@barista/shared/flavors";
import { lexiconsFor, workspaceLexicon } from "./flavorLexicon.js";
import type { db } from "./db.js";

type Conn = Pick<typeof db, "select">;

export interface SavedPick {
  ownerId: string; // the brew log's or serving's id
  flavorKey: string;
  label: string;
  place: string | null;
}

// The keys sent, with their labels and places: each must be on the
// workspace's wheel, or (editing) already saved on this record, kept as saved
// after the wheel changed (docs/api/flavor-lexicon.md §2c).
export async function flavorPicks(conn: Conn, workspaceId: string, keys: readonly string[], saved: readonly SavedPick[] = []): Promise<FlavorPick[] | string> {
  if (keys.length === 0) return [];
  const { lexicon } = await workspaceLexicon(workspaceId, conn);
  const allowed = new Map(lexicon.flavors.map((f): [string, FlavorPick] => [f.key, { key: f.key, label: f.label, place: flavorPlace(lexicon, f.key) }]));
  for (const { flavorKey, label, place } of saved) if (!allowed.has(flavorKey)) allowed.set(flavorKey, { key: flavorKey, label, place });
  const picks: FlavorPick[] = [];
  for (const key of keys) {
    const pick = allowed.get(key);
    if (!pick) return `flavors: "${key}" isn't on this workspace's flavor wheel`;
    picks.push(pick);
  }
  return picks;
}

// Saved picks per record, in each workspace's wheel order, whatever order
// they were picked in.
export async function resolveSaved(owners: ReadonlyArray<{ id: string; workspaceId: string }>, rows: readonly SavedPick[]): Promise<Map<string, FlavorPick[]>> {
  const byOwner = new Map<string, FlavorPick[]>();
  if (rows.length === 0) return byOwner;
  const lexicons = await lexiconsFor([...new Set(owners.map((o) => o.workspaceId))]);
  const saved = new Map<string, FlavorPick[]>();
  for (const { ownerId, flavorKey, label } of rows) saved.set(ownerId, [...(saved.get(ownerId) ?? []), { key: flavorKey, label }]);
  for (const { id, workspaceId } of owners) {
    const picks = saved.get(id);
    if (picks) byOwner.set(id, resolvePicks(lexicons.get(workspaceId)!, picks));
  }
  return byOwner;
}
