// A workspace's own AI key and models (docs/api/workspaces.md §2d).
import { AI_PROVIDERS, lastFour, type AiProvider } from "@barista/shared/aiConfig";
import { workspaceAiConfigs } from "@barista/shared/schema";
import { encryptSecret } from "@barista/shared/secrets";
import { eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { aiStatus, sendAiCheck, type AiStatus } from "../aiConfig.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { requireMembership } from "../auth/membership.js";
import { config } from "../config.js";
import { db } from "../db.js";
import { parseBody, sendError } from "../http.js";

const model = z.string().trim().min(1).max(100);
const optionalModel = model.nullable().optional();
export const aiKey = z.string().trim().min(8).max(500);

// No base URL: only the server's admin says where requests go. strict()
// refuses one rather than dropping it.
const saveSchema = z
  .object({ provider: z.enum(AI_PROVIDERS), apiKey: aiKey.optional(), model, visionModel: optionalModel, webModel: optionalModel })
  .strict();

export interface OwnAiConfig {
  provider: AiProvider;
  keyLast4: string;
  model: string;
  visionModel: string | null;
  webModel: string | null;
}
export interface AiConfigResponse extends AiStatus {
  own: OwnAiConfig | null; // owners only
  canSaveKeys: boolean;
}

type Params = { workspaceId: string };

async function view(workspaceId: string, owner: boolean): Promise<AiConfigResponse> {
  const [row] = owner ? await db.select().from(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId)) : [];
  const own = row ? { provider: row.provider, keyLast4: row.apiKeyLast4, model: row.model, visionModel: row.visionModel, webModel: row.webModel } : null;
  return { ...(await aiStatus(workspaceId)), own, canSaveKeys: config.aiConfigSecret !== null };
}

export const aiConfigRouter = Router({ mergeParams: true });
aiConfigRouter.use(requireAuth);

aiConfigRouter.get("/", async (req: Request<Params>, res: Response<AiConfigResponse>) => {
  const role = await requireMembership(res, authedUserId(req), req.params.workspaceId);
  if (role) res.json(await view(req.params.workspaceId, role === "owner"));
});

// A new key, or the settings around the one saved. A different provider
// needs its own key.
aiConfigRouter.put("/", async (req: Request<Params>, res: Response<AiConfigResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  const body = parseBody(saveSchema, req, res);
  if (!body) return;
  const [saved] = await db.select().from(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId));
  if (!body.apiKey && (!saved || saved.provider !== body.provider)) {
    sendError(res, 400, "Enter the API key");
    return;
  }
  if (body.apiKey && !config.aiConfigSecret) {
    sendError(res, 409, "Keys can't be saved until AI_CONFIG_SECRET is set on the server");
    return;
  }
  const values = {
    provider: body.provider,
    apiKeyEncrypted: body.apiKey ? encryptSecret(body.apiKey, config.aiConfigSecret!) : saved!.apiKeyEncrypted,
    apiKeyLast4: body.apiKey ? lastFour(body.apiKey) : saved!.apiKeyLast4,
    model: body.model,
    visionModel: body.visionModel ?? null,
    webModel: body.webModel ?? null,
  };
  await db.insert(workspaceAiConfigs).values({ workspaceId, ...values }).onDuplicateKeyUpdate({ set: values });
  res.json(await view(workspaceId, true));
});

// On the saved key, so one has to be saved first.
for (const action of ["models", "test"] as const) {
  aiConfigRouter.post(`/${action}`, async (req: Request<Params>, res: Response) => {
    const { workspaceId } = req.params;
    if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
    const [saved] = await db.select({ workspaceId: workspaceAiConfigs.workspaceId }).from(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId));
    if (!saved) {
      sendError(res, 409, "Save a key first");
      return;
    }
    await sendAiCheck(res, { workspaceId, action });
  });
}

aiConfigRouter.delete("/", async (req: Request<Params>, res: Response<AiConfigResponse>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, ["owner"]))) return;
  await db.delete(workspaceAiConfigs).where(eq(workspaceAiConfigs.workspaceId, workspaceId));
  res.json(await view(workspaceId, true));
});
