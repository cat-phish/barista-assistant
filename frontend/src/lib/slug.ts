// Workspace web addresses (/menu/:slug), shared by creating and renaming a workspace.

export const SLUG_PATTERN = /^[a-z0-9-]{3,64}$/; // same rule as the API (§2)

// "Jordan's Café" -> "jordans-cafe"
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
