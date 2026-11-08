import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireMembership, WRITE_ROLES } from "../auth/membership.js";
import { db } from "../db.js";
import { isDuplicateEntryError, parseBody, sendError } from "../http.js";
import { authedUserId, requireAuth } from "../middleware/requireAuth.js";
import { notes, type Note } from "@barista/shared/schema";
import { noteBlocksSchema, updateSchema } from "../validation.js";

// docs/api/notes.md §3h
export type NoteSummary = Omit<Note, "workspaceId">;

interface WorkspaceParams {
  workspaceId: string;
}
interface NoteParams extends WorkspaceParams {
  noteId: string;
}

// Text blocks and calculators can be large: a bigger JSON limit than the
// default 100 kB (app.ts).
export const NOTE_BODY_PATH = /^\/api\/workspaces\/[^/]+\/notes(\/[^/]+)?$/;
const noteFields = {
  title: z.string().trim().min(1).max(100),
  // In order, replaced as a whole; text kept as written (line breaks are formatting).
  blocks: noteBlocksSchema,
};
const createSchema = z.object({ ...noteFields, blocks: noteFields.blocks.optional() }).strict();
const updateNoteSchema = updateSchema({ ...noteFields, pinned: z.boolean() });

const summary = {
  id: notes.id,
  title: notes.title,
  blocks: notes.blocks,
  pinnedAt: notes.pinnedAt,
  createdAt: notes.createdAt,
  updatedAt: notes.updatedAt,
};

function inWorkspace(p: NoteParams) {
  return and(eq(notes.id, p.noteId), eq(notes.workspaceId, p.workspaceId));
}

// Pinned first (most recently pinned first), then the most recently changed.
async function listNotes(workspaceId: string): Promise<NoteSummary[]> {
  return db
    .select(summary)
    .from(notes)
    .where(eq(notes.workspaceId, workspaceId))
    .orderBy(sql`${notes.pinnedAt} IS NULL`, desc(notes.pinnedAt), desc(notes.updatedAt), asc(notes.title));
}
async function getNote(p: NoteParams): Promise<NoteSummary | null> {
  return (await db.select(summary).from(notes).where(inWorkspace(p)))[0] ?? null;
}

const duplicate = (res: Response, err: unknown): boolean => {
  if (!isDuplicateEntryError(err)) return false;
  sendError(res, 409, "A note with that title already exists");
  return true;
};

// Mounted at /api/workspaces/:workspaceId/notes
export const notesRouter = Router({ mergeParams: true });
notesRouter.use(requireAuth);

notesRouter.get("/", async (req: Request<WorkspaceParams>, res: Response<{ notes: NoteSummary[] }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId))) return;
  res.json({ notes: await listNotes(workspaceId) });
});

notesRouter.post("/", async (req: Request<WorkspaceParams>, res: Response<{ note: NoteSummary }>) => {
  const { workspaceId } = req.params;
  if (!(await requireMembership(res, authedUserId(req), workspaceId, WRITE_ROLES))) return;
  const body = parseBody(createSchema, req, res);
  if (!body) return;
  const id = randomUUID();
  try {
    await db.insert(notes).values({ id, workspaceId, title: body.title, blocks: body.blocks ?? [] });
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const note = await getNote({ workspaceId, noteId: id });
  if (!note) throw new Error(`Note ${id} missing after insert`);
  res.status(201).json({ note });
});

notesRouter.patch("/:noteId", async (req: Request<NoteParams>, res: Response<{ note: NoteSummary }>) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const body = parseBody(updateNoteSchema, req, res);
  if (!body) return;
  const { pinned, ...fields } = body;
  const set = {
    ...fields,
    // Keep the original pin date if it's already pinned.
    ...(pinned === true ? { pinnedAt: sql`COALESCE(${notes.pinnedAt}, NOW())` } : {}),
    ...(pinned === false ? { pinnedAt: null } : {}),
  };
  try {
    const [result] = await db.update(notes).set(set).where(inWorkspace(req.params));
    if (result.affectedRows === 0) {
      sendError(res, 404, "Note not found");
      return;
    }
  } catch (err) {
    if (duplicate(res, err)) return;
    throw err;
  }
  const note = await getNote(req.params);
  if (!note) {
    sendError(res, 404, "Note not found");
    return;
  }
  res.json({ note });
});

// Nothing uses a note: no /usage, no unlinking (docs/api/notes.md §3h).
notesRouter.delete("/:noteId", async (req: Request<NoteParams>, res: Response) => {
  if (!(await requireMembership(res, authedUserId(req), req.params.workspaceId, WRITE_ROLES))) return;
  const [result] = await db.delete(notes).where(inWorkspace(req.params));
  if (result.affectedRows === 0) {
    sendError(res, 404, "Note not found");
    return;
  }
  res.status(204).end();
});
