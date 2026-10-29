import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db.js";
import { sendError } from "./http.js";
import { analyzeRouter } from "./routes/analyze.js";
import { authRouter } from "./routes/auth.js";
import { aiPromptRouter } from "./routes/aiPrompt.js";
import { notificationsRouter } from "./routes/notifications.js";
import { beansRouter } from "./routes/beans.js";
import { beanPhotosRouter } from "./routes/beanPhotos.js";
import { beanLabelRouter, LABEL_BODY_PATH } from "./routes/beanLabel.js";
import { brewLogsRouter } from "./routes/brewLogs.js";
import { statsRouter } from "./routes/stats.js";
import { brewersRouter } from "./routes/brewers.js";
import { grindersRouter } from "./routes/grinders.js";
import { roastingMachinesRouter } from "./routes/roastingMachines.js";
import { greenCoffeesRouter } from "./routes/greenCoffees.js";
import { waterProfilesRouter } from "./routes/waterProfiles.js";
import { prepToolsRouter } from "./routes/prepTools.js";
import { backupRouter, LARGE_BODY_PATH } from "./routes/backup.js";
import { serverRouter } from "./routes/server.js";
import { brewProblemsRouter } from "./routes/brewProblems.js";
import { ingredientsRouter } from "./routes/ingredients.js";
import { drinkCategoriesRouter } from "./routes/drinkCategories.js";
import { beanProcessesRouter } from "./routes/beanProcesses.js";
import { recipeStylesRouter } from "./routes/recipeStyles.js";
import { brewerMethodsRouter } from "./routes/brewerMethods.js";
import { drinksRouter } from "./routes/drinks.js";
import { membersRouter } from "./routes/members.js";
import { menuRouter } from "./routes/menu.js";
import { publicMenuRouter } from "./routes/publicMenu.js";
import { recipesRouter } from "./routes/recipes.js";
import { parameterSuggestionsRouter } from "./routes/parameterSuggestions.js";
import { workspacesRouter } from "./routes/workspaces.js";

interface HealthResponse {
  status: "ok" | "error";
  db: "up" | "down";
}

// The Express app without a listening server, so tests can drive it directly.
export const app = express();
app.set("trust proxy", config.trustProxy);

app.use(cors({ origin: config.corsOrigin, credentials: true }));
// A restore or import uploads a backup file (docs/api/backup.md §2b);
// everything else keeps the default 100 kB limit.
const jsonBody = express.json();
const restoreBody = express.json({ limit: "50mb" });
const labelBody = express.json({ limit: "25mb" }); // up to 6 photos, base64
app.use((req, res, next) => (LARGE_BODY_PATH.test(req.path) ? restoreBody : LABEL_BODY_PATH.test(req.path) ? labelBody : jsonBody)(req, res, next));
app.use(cookieParser());

app.get("/health", async (_req: Request, res: Response<HealthResponse>) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", db: "up" });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(503).json({ status: "error", db: "down" });
  }
});

app.use("/api/auth/me/notifications", notificationsRouter);
app.use("/api/auth/me/ai-prompt", aiPromptRouter);
app.use("/api/auth", authRouter);
app.use("/api/public/menu", publicMenuRouter);
app.use("/api/workspaces/:workspaceId/brewers", brewersRouter);
app.use("/api/workspaces/:workspaceId/grinders", grindersRouter);
app.use("/api/workspaces/:workspaceId/roasting-machines", roastingMachinesRouter); // docs/api/roasting-machines.md §3f
app.use("/api/workspaces/:workspaceId/green-coffees", greenCoffeesRouter); // docs/api/green-coffees.md §4e
app.use("/api/workspaces/:workspaceId/water-profiles", waterProfilesRouter);
app.use("/api/workspaces/:workspaceId/prep-tools", prepToolsRouter);
app.use("/api/workspaces/:workspaceId/brew-problems", brewProblemsRouter);
app.use("/api/workspaces/:workspaceId/ingredients", ingredientsRouter);
app.use("/api/workspaces/:workspaceId/drink-categories", drinkCategoriesRouter);
app.use("/api/workspaces/:workspaceId/bean-processes", beanProcessesRouter);
app.use("/api/workspaces/:workspaceId/recipe-styles", recipeStylesRouter);
app.use("/api/workspaces/:workspaceId/brewer-methods", brewerMethodsRouter);
app.use("/api/workspaces/:workspaceId/drinks", drinksRouter);
app.use("/api/workspaces/:workspaceId/members", membersRouter);
app.use("/api/workspaces/:workspaceId/menu", menuRouter);
app.use("/api/workspaces/:workspaceId/beans/:beanId/photos", beanPhotosRouter);
app.use("/api/workspaces/:workspaceId/bean-label", beanLabelRouter);
app.use("/api/workspaces/:workspaceId/beans", beansRouter);
app.use("/api/workspaces/:workspaceId/recipes", recipesRouter);
app.use("/api/workspaces/:workspaceId/brew-logs", brewLogsRouter);
app.use("/api/workspaces/:workspaceId/stats", statsRouter); // docs/api/stats.md §11
app.use("/api/workspaces/:workspaceId/parameter-suggestions", parameterSuggestionsRouter);
app.use("/api/brew-logs", analyzeRouter);
app.use("/api/server", serverRouter); // server admins (docs/api/server.md §10)
app.use("/api/workspaces", backupRouter); // GET /:workspaceId/backup, POST /restore
app.use("/api/workspaces", workspacesRouter);

app.use("/api", (_req: Request, res: Response) => {
  sendError(res, 404, "Not found");
});

// Express 5 forwards rejected promises from async handlers here.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    sendError(res, 400, "Malformed JSON body");
    return;
  }
  if (typeof err === "object" && err !== null && "type" in err && err.type === "entity.too.large") {
    sendError(res, 413, "Request body too large");
    return;
  }
  console.error("Unhandled error:", err);
  if (!res.headersSent) {
    sendError(res, 500, "Internal server error");
  }
});
