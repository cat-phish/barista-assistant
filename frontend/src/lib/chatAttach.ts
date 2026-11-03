// What a chat message attaches (docs/api/chat.md §12), as picked in
// ChatAttachDialog and shown as chips in StatsChatView: up to the
// workspace's chatMaxAttachments, each item once.
import type { ChatAttachment, ChatAttachmentKind } from '../api/chats';

export const ATTACH_KINDS: readonly ChatAttachmentKind[] = ['brew', 'bean', 'recipe', 'chart'];
export const KIND_NAMES: Record<ChatAttachmentKind, { one: string; many: string }> = {
  brew: { one: 'Brew', many: 'brews' },
  bean: { one: 'Bean', many: 'beans' },
  recipe: { one: 'Recipe', many: 'recipes' },
  chart: { one: 'Chart', many: 'charts' },
};

type Ref = Pick<ChatAttachment, 'kind' | 'id'>;
export const attachKey = (a: Ref): string => `${a.kind}:${a.id}`;

export function isPicked(selection: readonly ChatAttachment[], item: Ref): boolean {
  return selection.some((a) => a.kind === item.kind && a.id === item.id);
}

// Ticked off if it's there, else added while there's room.
export function toggle(selection: readonly ChatAttachment[], item: ChatAttachment, max: number): ChatAttachment[] {
  if (isPicked(selection, item)) return selection.filter((a) => attachKey(a) !== attachKey(item));
  return selection.length < max ? [...selection, item] : [...selection];
}

// Adds the items not yet picked, in order, until it's full. left: how many
// didn't fit.
export function selectAll(selection: readonly ChatAttachment[], items: readonly ChatAttachment[], max: number): { selection: ChatAttachment[]; left: number } {
  const fresh = items.filter((item, i) => !isPicked(selection, item) && items.findIndex((x) => attachKey(x) === attachKey(item)) === i);
  const room = Math.max(0, max - selection.length);
  return { selection: [...selection, ...fresh.slice(0, room)], left: Math.max(0, fresh.length - room) };
}

export function withoutKind(selection: readonly ChatAttachment[], kind: ChatAttachmentKind): ChatAttachment[] {
  return selection.filter((a) => a.kind !== kind);
}

// Chips by kind, brews first; kinds with nothing are left out.
export function groupByKind(selection: readonly ChatAttachment[]): Array<{ kind: ChatAttachmentKind; items: ChatAttachment[] }> {
  return ATTACH_KINDS.map((kind) => ({ kind, items: selection.filter((a) => a.kind === kind) })).filter((g) => g.items.length > 0);
}

export function countLabel(kind: ChatAttachmentKind, n: number): string {
  return n === 1 ? `1 ${KIND_NAMES[kind].one.toLowerCase()}` : `${n} ${KIND_NAMES[kind].many}`;
}

// The labels the server gives them (backend chats.ts labelled), for the chips
// until it sends its own back.
export const brewAttachLabel = (b: { timestamp: string; bean: { beanName: string } }): string => `${b.bean.beanName}, ${b.timestamp.slice(0, 10)}`;
export const beanAttachLabel = (b: { roasterName: string; beanName: string }): string => `${b.roasterName} ${b.beanName}`;

// A case-blind match on every word, for the Beans and Recipes search.
export function matches(text: string, query: string): boolean {
  const hay = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}
