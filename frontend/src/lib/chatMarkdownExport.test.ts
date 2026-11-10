import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../api/chats';
import { chatFileName, chatToMarkdown } from './chatMarkdownExport';

const msg = (fields: Partial<ChatMessage>): ChatMessage => ({ id: 'x', position: 1, role: 'user', content: '', attachments: [], proposals: [], photos: [], status: 'done', error: null, model: null, createdAt: '2026-11-09T14:02:00Z', ...fields });

describe('chatToMarkdown', () => {
  it('has the title, the summary, each message with what it attached, and proposals', () => {
    const md = chatToMarkdown({ title: 'Guji dial-in', createdAt: '2026-11-01T09:00:00Z', updatedAt: '2026-11-09T14:02:00Z', summary: 'Grinding at 22 clicks.' }, [
      msg({ content: 'How did the week go?', attachments: [{ kind: 'period', id: 'p', label: 'Brews, last 7 days · Guji' }], photos: [{ id: 'f', width: 1, height: 1 }] }),
      msg({ role: 'assistant', content: '**Steady.**', proposals: [{ kind: 'brew', title: 'Go finer', why: 'It ran fast.', state: 'dismissed' } as never] }),
      msg({ role: 'assistant', status: 'pending' }),
    ]);
    expect(md).toContain('# Guji dial-in\n');
    expect(md).toContain('## Summary of the earlier messages\n\nGrinding at 22 clicks.');
    expect(md).toContain('### You · ');
    expect(md).toContain('Attached: Period: Brews, last 7 days · Guji\n\n(1 photo)\n\nHow did the week go?');
    expect(md).toContain('### AI · ');
    expect(md).toContain('**Steady.**\n\nProposed:\n- **Go finer** (dismissed): It ran fast.');
    expect(md.match(/### AI/g)).toHaveLength(1);
  });
  it('names the file after the chat', () => {
    expect(chatFileName('Guji: dial-in?', 'md', new Date('2026-11-09T00:00:00Z'))).toBe('chat-guji-dial-in-2026-11-09.md');
    expect(chatFileName('☕', 'zip', new Date('2026-11-09T00:00:00Z'))).toBe('chat-chat-2026-11-09.zip');
  });
});
