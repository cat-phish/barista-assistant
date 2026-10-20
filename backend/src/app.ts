import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db.js";
import { sendError } from "./http.js";
import { analyzeRouter } from "./routes/analyze.js";
import { authRouter } from "./routes/auth.js";
import { beansRouter } from "./routes/beans.js";
import { brewLogsRouter } from "./routes/brewLogs.js";
import { brewersRouter } from "./routes/brewers.js";
import { grindersRouter } from "./routes/grinders.js";
import { ingredientsRouter } from "./routes/ingredients.js";
import { drinkCategoriesRouter } from "./routes/drinkCategories.js";
import { drinksRouter } from "./routes/drinks.js";
import { membersRouter } from "./routes/members.js";
import { publicMenuRouter } from "./routes/publicMenu.js";
import { recipesRouter } from "./routes/recipes.js";
import { suggestionsRouter } from "./routes/suggestions.js";
import { workspacesRouter } from "./routes/workspaces.js";

interface HealthResponse {
  status: "ok" | "error";
  db: "up" | "down";
}

// The Express app without a listening server, so tests can drive it directly.
export const app = express();

app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());
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

app.use("/api/auth", authRouter);
app.use("/api/public/menu", publicMenuRouter);
app.use("/api/workspaces/:workspaceId/brewers", brewersRouter);
app.use("/api/workspaces/:workspaceId/grinders", grindersRouter);
app.use("/api/workspaces/:workspaceId/ingredients", ingredientsRouter);
app.use("/api/workspaces/:workspaceId/drink-categories", drinkCategoriesRouter);
app.use("/api/workspaces/:workspaceId/drinks", drinksRouter);
app.use("/api/workspaces/:workspaceId/members", membersRouter);
app.use("/api/workspaces/:workspaceId/beans", beansRouter);
app.use("/api/workspaces/:workspaceId/recipes", recipesRouter);
app.use("/api/workspaces/:workspaceId/brew-logs", brewLogsRouter);
app.use("/api/beans", suggestionsRouter);
app.use("/api/brew-logs", analyzeRouter);
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
  console.error("Unhandled error:", err);
  if (!res.headersSent) {
    sendError(res, 500, "Internal server error");
  }
});
