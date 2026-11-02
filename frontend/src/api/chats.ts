import { API_URL, api } from './client';

// docs/api/chat.md §12: a person's own chats.
export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
export type ChatAttachmentKind = 'brew' | 'bean' | 'recipe';
export interface ChatAttachmentRef {
  kind: ChatAttachmentKind;
  id: string;
}
export interface ChatAttachment extends ChatAttachmentRef {
  label: string;
}
export interface ChatMessage {
  id: string;
  position: number;
  role: 'user' | 'assistant';
  content: string;
  attachments: ChatAttachment[];
  status: 'pending' | 'done' | 'failed';
  error: string | null;
  model: string | null;
  createdAt: string;
}
export interface ChatPair {
  chat: Chat;
  messages: ChatMessage[];
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/chats`;

export const chatsApi = {
  list(workspaceId: string) {
    return api.get<{ chats: Chat[] }>(base(workspaceId));
  },
  get(workspaceId: string, chatId: string) {
    return api.get<ChatPair>(`${base(workspaceId)}/${chatId}`);
  },
  start(workspaceId: string, content: string, attachments: ChatAttachmentRef[]) {
    return api.post<ChatPair>(base(workspaceId), { content, attachments });
  },
  send(workspaceId: string, chatId: string, content: string, attachments: ChatAttachmentRef[]) {
    return api.post<ChatPair>(`${base(workspaceId)}/${chatId}/messages`, { content, attachments });
  },
  remove(workspaceId: string, chatId: string) {
    return api.delete<void>(`${base(workspaceId)}/${chatId}`);
  },
  // Follows a reply. EventSource reconnects by itself and carries on from its
  // last event; onClosed is for when it gives up (the chat is gone, say).
  // Returns a function that stops following.
  follow(workspaceId: string, chatId: string, messageId: string, on: { text(text: string): void; done(message: ChatMessage): void; closed(): void }): () => void {
    const source = new EventSource(`${API_URL}${base(workspaceId)}/${chatId}/messages/${messageId}/stream`, { withCredentials: true });
    source.addEventListener('text', (e) => on.text((JSON.parse(e.data as string) as { text: string }).text));
    source.addEventListener('done', (e) => {
      source.close();
      on.done(JSON.parse(e.data as string) as ChatMessage);
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) on.closed();
    };
    return () => source.close();
  },
};
