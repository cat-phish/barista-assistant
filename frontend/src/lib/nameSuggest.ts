// Suggestions for the bean form's name fields (roaster, coffee, producer,
// green supplier), from the workspace's beans, archived ones too. Spelling
// drifts ("Onyx" vs "Onyx Coffee Lab"), so names are compared folded, and a
// roaster's trailing "Coffee"/"Roasters" doesn't count.

// Words a roaster's name often ends with that don't tell two apart.
const FILLER = new Set([
  'coffee', 'coffees', 'roaster', 'roasters', 'roastery', 'roasting', 'roasted',
  'co', 'company', 'lab', 'labs', 'inc', 'ltd', 'llc',
]);

// Lowercase, accents and punctuation off, spaces collapsed.
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Folded, with trailing filler words dropped (but never the first word):
// "Proud Mary Coffee Roasters" and "Proud Mary" are the same name.
export function normalizeName(s: string): string {
  const words = foldName(s).split(' ').filter(Boolean);
  while (words.length > 1 && FILLER.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

// Each name once (ignoring case and accents), in the spelling used most,
// sorted.
export function distinctNames(values: readonly (string | null | undefined)[]): string[] {
  const groups = new Map<string, Map<string, number>>();
  for (const raw of values) {
    const name = raw?.trim();
    if (!name) continue;
    const key = foldName(name);
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(name, (spellings.get(name) ?? 0) + 1);
    groups.set(key, spellings);
  }
  const names = [...groups.values()].map((spellings) =>
    [...spellings.entries()].reduce((best, s) => (s[1] > best[1] ? s : best))[0],
  );
  return names.sort((a, b) => a.localeCompare(b));
}

// Edits (insert, delete, change, swap two letters) between two strings.
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// How many typos still count as the same name: none below 4 letters.
function typos(length: number): number {
  return length < 4 ? 0 : length < 8 ? 1 : 2;
}

export interface RankOptions {
  prefer?: readonly string[]; // first within each tier (that roaster's coffees)
  limit?: number;
}

// Names for what's typed, closest first: starts with it, then a word starts
// with it, then contains it (from two letters), then a typo away. What's typed exactly isn't
// offered.
export function rankNames(query: string, names: readonly string[], { prefer = [], limit = 6 }: RankOptions = {}): string[] {
  const q = foldName(query);
  if (!q) return [];
  const preferred = new Set(prefer.map(foldName));
  const tiered: { name: string; tier: number; preferred: boolean }[] = [];
  for (const name of names) {
    const n = foldName(name);
    if (n === q) continue;
    let tier: number;
    if (n.startsWith(q)) tier = 0;
    else if (n.split(' ').some((w) => w.startsWith(q))) tier = 1;
    else if (q.length > 1 && n.includes(q)) tier = 2; // one letter is in most names
    // A typo while typing: against as much of the name as is typed.
    else if (typos(q.length) > 0 && distance(q, n.slice(0, q.length)) <= typos(q.length)) tier = 3;
    else continue;
    tiered.push({ name, tier, preferred: preferred.has(n) });
  }
  return tiered
    .sort((a, b) => a.tier - b.tier || Number(b.preferred) - Number(a.preferred))
    .slice(0, limit)
    .map((t) => t.name);
}

// Whether one name is the other with words after it ("Proud Mary Melbourne"
// for "Proud Mary"): whole words, and the shorter at least 5 letters, so
// "Co" or "The" alone don't match everything.
function extends_(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(`${short} `);
}

// An existing name that's what's typed spelled differently ("Proud Mary" for
// "Proud Mary Coffee Roasters", "Onxy" for "Onyx", "Proud Mary Melbourne"),
// for "You have … · Use". Null when it's already exactly one of them, or
// nothing is close. The closest wins: the same name, then a typo, then more
// words.
export function closeMatch(value: string, names: readonly string[]): string | null {
  const v = value.trim();
  if (!v || names.includes(v)) return null;
  const nv = normalizeName(v);
  let best: { name: string; d: number } | null = null;
  for (const name of names) {
    const nn = normalizeName(name);
    const typo = distance(nv, nn);
    const d = typo <= typos(nv.length) ? typo : extends_(nv, nn) ? 100 + Math.abs(nn.length - nv.length) : null;
    if (d !== null && (!best || d < best.d)) best = { name, d };
  }
  return best?.name ?? null;
}

// The latest bag of a coffee the workspace has had (same roaster and coffee
// name), to start a new bean from it like Duplicate.
export function lastBag<B extends { roasterName: string; beanName: string; roastDate: string | null; createdAt: string }>(
  beans: readonly B[],
  roaster: string,
  coffee: string,
): B | null {
  const r = normalizeName(roaster);
  const c = foldName(coffee);
  if (!r || !c) return null;
  const when = (b: B): string => b.roastDate ?? b.createdAt;
  return beans
    .filter((b) => normalizeName(b.roasterName) === r && foldName(b.beanName) === c)
    .reduce<B | null>((latest, b) => (!latest || when(b) > when(latest) ? b : latest), null);
}
