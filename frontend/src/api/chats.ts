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
export interface ChatPhoto {
  id: string;
  width: number;
  height: number;
}
export interface ChatMessage {
  id: string;
  position: number;
  role: 'user' | 'assistant';
  content: string;
  attachments: ChatAttachment[];
  photos: ChatPhoto[];
  status: 'pending' | 'done' | 'failed';
  error: string | null;
  model: string | null;
  createdAt: string;
}
export interface ChatPair {
  chat: Chat;
  messages: ChatMessage[];
}

export interface ChatSend {
  content: string;
  attachments: ChatAttachmentRef[];
  photoIds: string[];
}

// null: no limit.
export interface ChatLimits {
  maxBytes: number | null;
  maxDays: number | null;
}
export interface ServerChatLimits extends ChatLimits {
  dailyMessages: number | null;
}
export interface ChatSettings {
  own: ChatLimits;
  server: ServerChatLimits;
  effective: ChatLimits;
  usedBytes: number;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/chats`;

export const chatSettingsApi = {
  get: () => api.get<ChatSettings>('/api/auth/me/chat-settings'),
  save: (limits: ChatLimits) => api.put<ChatSettings>('/api/auth/me/chat-settings', limits),
  purge: () => api.delete('/api/auth/me/chats'),
};

export const chatsApi = {
  list(workspaceId: string) {
    return api.get<{ chats: Chat[]; canSend: boolean }>(base(workspaceId));
  },
  get(workspaceId: string, chatId: string) {
    return api.get<ChatPair>(`${base(workspaceId)}/${chatId}`);
  },
  start(workspaceId: string, body: ChatSend) {
    return api.post<ChatPair>(base(workspaceId), body);
  },
  send(workspaceId: string, chatId: string, body: ChatSend) {
    return api.post<ChatPair>(`${base(workspaceId)}/${chatId}/messages`, body);
  },
  addPhoto(workspaceId: string, image: Blob) {
    return api.post<{ photo: ChatPhoto }>(`${base(workspaceId)}/photos`, image);
  },
  photoUrl(workspaceId: string, photoId: string) {
    return `${API_URL}${base(workspaceId)}/photos/${photoId}`;
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
