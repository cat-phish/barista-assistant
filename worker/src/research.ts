// Research settings (docs/api/research.md §1f): what one person's analyses
// and suggestions in one workspace get. The person's choices beat the
// workspace's defaults; their own findings are private (SEC-22), the
// workspace's shared.
import { eq } from "drizzle-orm";
import { resolveResearch, withResearchDefaults, type ResolvedResearch } from "@barista/shared/researchSettings";
import { users, workspaces } from "@barista/shared/schema";
import { db } from "./db.js";

export async function loadResearch(userId: string | null, workspaceId: string): Promise<ResolvedResearch> {
  const [[person], [ws]] = await Promise.all([
    userId ? db.select({ r: users.research }).from(users).where(eq(users.id, userId)) : Promise.resolve([]),
    db.select({ r: workspaces.research }).from(workspaces).where(eq(workspaces.id, workspaceId)),
  ]);
  return resolveResearch(person ? withResearchDefaults(person.r) : null, ws ? withResearchDefaults(ws.r) : null);
}

// The findings kept "only as an experiment" (built-in and own), for
// chat-style experiment ideas; never for an analysis or a suggestion.
export function experimentFindings(research: ResolvedResearch): { builtIn: string[]; own: ResolvedResearch["own"] } {
  return {
    builtIn: Object.entries(research.builtIn).flatMap(([key, mode]) => (mode === "experiment" ? [key] : [])),
    own: research.own.filter((f) => f.mode === "experiment"),
  };
}
