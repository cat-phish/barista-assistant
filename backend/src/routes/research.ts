import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { RESEARCH_FINDINGS, RESEARCH_VERSION, type ResearchFinding } from "@barista/shared/research";
import {
  findingsUpdatedSince,
  MAX_FINDING_SOURCE,
  MAX_FINDING_TEXT,
  MAX_FINDING_TITLE,
  MAX_OWN_FINDINGS,
  MAX_RESEARCH_NOTE,
  withResearchDefaults,
  withUserResearchDefaults,
  type ResearchSettings,
  type UserResearch,
} from "@barista/shared/researchSettings";
import { users, workspaces } from "@barista/shared/schema";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";
import { requireMembership } from "../auth/membership.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { mergeFindings, researchPutSchema } from "../research.js";

// Research settings (docs/api/research.md §1f): the person's own, and the
// workspace's defaults and shared findings.

export type BuiltInFinding = Pick<ResearchFinding, "key" | "title" | "text" | "levers" | "evidence" | "scope" | "experiment" | "source" | "since">;
export const BUILT_IN: BuiltInFinding[] = RESEARCH_FINDINGS.map(({ key, title, text, levers, evidence, scope, experiment, source, since }) => ({ key, title, text, levers, evidence, scope, experiment, source, since }));
export const RESEARCH_LIMITS = { findings: MAX_OWN_FINDINGS, title: MAX_FINDING_TITLE, text: MAX_FINDING_TEXT, source: MAX_FINDING_SOURCE, note: MAX_RESEARCH_NOTE } as const;

export interface MyResearchResponse {
  research: UserResearch;
  builtIn: BuiltInFinding[];
  version: string; // RESEARCH_VERSION
  updated: string[]; // built-in keys reworded since the version they dismissed
  limits: typeof RESEARCH_LIMITS;
}
const respondMine = (r: UserResearch): MyResearchResponse => ({ research: r, builtIn: BUILT_IN, version: RESEARCH_VERSION, updated: findingsUpdatedSince(r.seenVersion), limits: RESEARCH_LIMITS });

async function loadMine(userId: string): Promise<UserResearch | undefined> {
  const [row] = await db.select({ r: users.research }).from(users).where(eq(users.id, userId));
  return row ? withUserResearchDefaults(row.r) : undefined;
}

export const researchRouter = Router();
researchRouter.use(requireAuth);

researchRouter.get("/", async (req: Request, res: Response<MyResearchResponse>) => {
  const r = await loadMine(authedUserId(req));
  if (!r) {
    sendError(res, 401, "Not authenticated");
    return;
  }
  res.json(respondMine(r));
});

researchRouter.put("/", async (req: Request, res: Response<MyResearchResponse>) => {
  const body = parseBody(researchPutSchema, req, res);
  if (!body) return;
  const userId = authedUserId(req);
  const stored = await loadMine(userId);
  if (!stored) {
    sendError(res, 401, "Not authenticated");
    return;
  }
  const own = mergeFindings(stored.own, body.own, new Date().toISOString());
  if (!own) {
    sendError(res, 400, "own: no such finding");
    return;
  }
  const next: UserResearch = { settings: body.settings, own, seenVersion: stored.seenVersion };
  await db.update(users).set({ research: next }).where(eq(users.id, userId));
  res.json(respondMine(next));
});

// Dismisses the "research updated" notice up to the current version.
researchRouter.post("/seen", async (req: Request, res: Response<MyResearchResponse>) => {
  const userId = authedUserId(req);
  const stored = await loadMine(userId);
  if (!stored) {
    sendError(res, 401, "Not authenticated");
    return;
  }
  const next: UserResearch = { ...stored, seenVersion: RESEARCH_VERSION };
  await db.update(users).set({ research: next }).where(eq(users.id, userId));
  res.json(respondMine(next));
});

// The workspace's: /api/workspaces/:workspaceId/research. Members read it,
// owners change it.
export interface WorkspaceResearchResponse {
  research: ResearchSettings;
  limits: typeof RESEARCH_LIMITS;
}
type WorkspaceParams = { workspaceId: string };
export const workspaceResearchRouter = Router({ mergeParams: true });
workspaceResearchRouter.use(requireAuth);

async function loadWorkspace(workspaceId: string): Promise<ResearchSettings | undefined> {
  const [row] = await db.select({ r: workspaces.research }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return row ? withResearchDefaults(row.r) : undefined;
}

workspaceResearchRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<WorkspaceResearchResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  const research = await loadWorkspace(workspaceId);
  if (!research) {
    sendError(res, 404, "Workspace not found");
    return;
  }
  res.json({ research, limits: RESEARCH_LIMITS });
});

workspaceResearchRouter.put("/", async (req: Request<WorkspaceParams>, res: Response<WorkspaceResearchResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const body = parseBody(researchPutSchema, req, res);
  if (!body) return;
  const stored = await loadWorkspace(workspaceId);
  if (!stored) {
    sendError(res, 404, "Workspace not found");
    return;
  }
  const own = mergeFindings(stored.own, body.own, new Date().toISOString());
  if (!own) {
    sendError(res, 400, "own: no such finding");
    return;
  }
  const next: ResearchSettings = { settings: body.settings, own };
  await db.update(workspaces).set({ research: next }).where(eq(workspaces.id, workspaceId));
  res.json({ research: next, limits: RESEARCH_LIMITS });
});
