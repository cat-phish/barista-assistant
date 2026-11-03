// The markdown the AI writes in chat replies (docs/api/chat.md §12), parsed
// into a tree that ChatMarkdown.vue draws as elements. Never HTML: what the
// model writes is text, so nothing in it can run as markup. A small subset:
// paragraphs (a single line break stays a break), headings, lists (one level
// of nesting), quotes, fenced code, pipe tables and rules; bold, italic, code
// and http(s) links inline. A reply is parsed again as each piece arrives, so
// half-written markup is shown as text, and an open code fence as code.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'break' };

export interface ListItem {
  content: Inline[];
  sublist: ListBlock | null;
}
export interface ListBlock {
  type: 'list';
  ordered: boolean;
  start: number;
  items: ListItem[];
}
export type Align = 'left' | 'center' | 'right' | null;
export type Block =
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'heading'; level: 1 | 2 | 3; content: Inline[] }
  | ListBlock
  | { type: 'quote'; blocks: Block[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const SAFE_LINK = /^https?:\/\/[^\s]+$/i;

export function parseMarkdown(source: string): Block[] {
  return blocks(source.replace(/\r\n?/g, '\n').split('\n'));
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== fence[1]) body.push(lines[i++]!);
      i++; // the closing fence, or past the end while it's still being written
      out.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ type: 'heading', level: Math.min(heading[1]!.length, 3) as 1 | 2 | 3, content: inline(heading[2]!) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ type: 'rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(QUOTE.exec(lines[i++]!)![1]!);
      out.push({ type: 'quote', blocks: blocks(quoted) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
      const head = cells(line);
      const align = cells(lines[i + 1]!).map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      out.push({
        type: 'table',
        align: head.map((_, c) => align[c] ?? null),
        head: head.map(inline),
        rows: rows.map((r) => head.map((_, c) => inline(r[c] ?? ''))),
      });
      continue;
    }
    if (ITEM.test(line)) {
      const [list, next] = listAt(lines, i);
      out.push(list);
      i = next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines, i)) para.push(lines[i++]!.trim());
    if (!para.length) para.push(lines[i++]!.trim()); // a line that only looked like a block
    out.push({ type: 'paragraph', content: inline(para.join('\n')) });
  }
  return out;
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i]!;
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) || (line.includes('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]!) && lines[i + 1]!.includes('-'));
}

const indentOf = (line: string) => line.length - line.trimStart().length;

// A list from line i: its items, deeper ones as one item's sublist, and lines
// indented under an item joining it. Returns where it ended.
function listAt(lines: string[], start: number): [ListBlock, number] {
  const first = ITEM.exec(lines[start]!)!;
  const base = first[1]!.length;
  const ordered = first[3] !== undefined;
  const list: ListBlock = { type: 'list', ordered, start: ordered ? Number(first[3]) : 1, items: [] };
  let i = start;
  let text: string[] = [];
  let sub: string[] = [];
  const close = () => {
    if (!text.length) return;
    const sublist = sub.length ? (blocks(sub.map((l) => l.slice(Math.min(indentOf(l), base + 2)))).find((b): b is ListBlock => b.type === 'list') ?? null) : null;
    list.items.push({ content: inline(text.join('\n')), sublist });
    text = [];
    sub = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      // A blank line ends the list unless an item carries on after it.
      const next = lines[i + 1];
      if (next === undefined || !(ITEM.test(next) && indentOf(next) >= base) && indentOf(next) <= base) break;
      i++;
      continue;
    }
    const item = ITEM.exec(line);
    const indent = indentOf(line);
    if (item && indent <= base + 1) {
      if ((item[3] !== undefined) !== ordered) break; // the other kind starts a new list
      close();
      text = [item[4]!];
    } else if (indent > base + 1 && (item || sub.length)) {
      sub.push(line);
    } else if (indent > base && text.length) {
      text.push(line.trim());
    } else if (!item && text.length && !startsBlock(lines, i)) {
      text.push(line.trim()); // a lazy continuation line
    } else {
      break;
    }
    i++;
  }
  close();
  return [list, i];
}

function cells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}
function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

export function inline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\\' && i + 1 < source.length && /[\\`*_[\]()#|>~-]/.test(source[i + 1]!)) {
      text += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      out.push({ type: 'break' });
      i++;
      continue;
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && source[i + 1] === ch) {
      const mark = ch + ch;
      const end = source.indexOf(mark, i + 2);
      if (end > i + 2 && (ch === '*' || !isWord(source[i - 1]))) {
        flush();
        out.push({ type: 'strong', children: inline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === '*' || ch === '_') && source[i + 1] !== ch && source[i + 1] !== ' ' && (ch === '*' || !isWord(source[i - 1]))) {
      let end = i + 1;
      while ((end = source.indexOf(ch, end)) > 0 && (source[end + 1] === ch || source[end - 1] === ' ' || (ch === '_' && isWord(source[end + 1])))) end += source[end + 1] === ch ? 2 : 1;
      if (end > i + 1 && !source.slice(i + 1, end).includes('\n')) {
        flush();
        out.push({ type: 'em', children: inline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(source.slice(i));
      if (link) {
        flush();
        if (SAFE_LINK.test(link[2]!)) out.push({ type: 'link', href: link[2]!, children: inline(link[1]!) });
        else out.push(...inline(link[1]!)); // anything but http(s) stays text
        i += link[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}
