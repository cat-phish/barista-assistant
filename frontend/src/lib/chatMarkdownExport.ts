// One chat as a Markdown file (docs/api/chat.md §12, "Exporting a chat"): to
// read or share, not to import (the .zip is for that). Replies are Markdown
// already, so they go in as written.
import type { Chat, ChatMessage } from '../api/chats';
import { KIND_NAMES } from './chatAttach';

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function chatToMarkdown(chat: Pick<Chat, 'title' | 'createdAt' | 'updatedAt' | 'summary'>, messages: readonly ChatMessage[]): string {
  const out = [`# ${chat.title}`, '', `Started ${when(chat.createdAt)} · last message ${when(chat.updatedAt)}`];
  if (chat.summary) out.push('', '## Summary of the earlier messages', '', chat.summary);
  out.push('', '---');
  for (const m of messages) {
    if (m.status === 'pending') continue;
    out.push('', `### ${m.role === 'user' ? 'You' : 'AI'} · ${when(m.createdAt)}`, '');
    if (m.attachments.length) out.push(`Attached: ${m.attachments.map((a) => `${KIND_NAMES[a.kind].one}: ${a.label}`).join('; ')}`, '');
    if (m.photos.length) out.push(m.photos.length === 1 ? '(1 photo)' : `(${m.photos.length} photos)`, '');
    if (m.content) out.push(m.content);
    if (m.status === 'failed') out.push('', `*The reply failed${m.error ? `: ${m.error}` : ''}.*`);
    if (m.proposals.length) {
      out.push('', 'Proposed:');
      for (const p of m.proposals) out.push(`- **${p.title}**${p.state === 'dismissed' ? ' (dismissed)' : ''}: ${p.why}`);
    }
  }
  return `${out.join('\n')}\n`;
}

// "chat-guji-dial-in-2026-11-09.md"
export function chatFileName(title: string, ext: string, today = new Date()): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'chat';
  return `chat-${slug}-${today.toISOString().slice(0, 10)}.${ext}`;
}
