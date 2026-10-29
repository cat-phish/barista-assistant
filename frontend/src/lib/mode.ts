// Brew mode and roast mode (docs/backlog.md item 15): roast mode is every
// route under /roast, shown when the workspace turns on home roasting
// (docs/api/workspaces.md §2). Each device remembers, per workspace, the last
// mode used and the last page in each, so the app reopens where you were and
// the Brew | Roast switch goes back to the page you left. A convenience only:
// storage can be unavailable (private mode), and then the app opens on Brew.

export type AppMode = 'brew' | 'roast';

export const modeOf = (path: string): AppMode => (path === '/roast' || path.startsWith('/roast/') ? 'roast' : 'brew');

// The mode the header shows: Settings belongs to both, so it keeps the last one.
export const headerMode = (path: string, workspaceId: string | null): AppMode =>
  path.startsWith('/settings') && workspaceId ? lastMode(workspaceId) : modeOf(path);

interface Saved {
  mode: AppMode;
  brew?: string; // the last page in each mode, a same-app path
  roast?: string;
}

const key = (workspaceId: string) => `barista.mode.${workspaceId}`;

function read(workspaceId: string): Saved | null {
  try {
    const raw = localStorage.getItem(key(workspaceId));
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (typeof saved !== 'object' || saved === null) return null;
    const { mode, brew, roast } = saved as Record<string, unknown>;
    const page = (p: unknown, m: AppMode) => (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && modeOf(p) === m ? p : undefined);
    return { mode: mode === 'roast' ? 'roast' : 'brew', brew: page(brew, 'brew'), roast: page(roast, 'roast') };
  } catch {
    return null;
  }
}

// After each move to a page of the workspace: it's now the mode's last page.
export function rememberPage(workspaceId: string, path: string): void {
  const mode = modeOf(path);
  const next: Saved = { ...(read(workspaceId) ?? { mode }), mode, [mode]: path };
  try {
    localStorage.setItem(key(workspaceId), JSON.stringify(next));
  } catch {
    // Not remembering is fine.
  }
}

export function lastMode(workspaceId: string): AppMode {
  return read(workspaceId)?.mode ?? 'brew';
}

// The last page used in a mode, or null for its landing page.
export function lastPage(workspaceId: string, mode: AppMode): string | null {
  return read(workspaceId)?.[mode] ?? null;
}
