import { API_URL, api } from './client';
import type { StepType } from './types';

// docs/api/chat.md §12: a person's own chats.
export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  // Summarize and continue (chat.md §12, "Long chats"): the older messages'
  // summary, through that position; pending while one is written.
  summary: string | null;
  summaryThrough: number | null;
  summaryStatus: 'pending' | 'failed' | null;
}
export type ChatAttachmentKind = 'brew' | 'bean' | 'recipe' | 'chart' | 'period';
// A live Period (chat.md §12, "Periods"): the Brews filters, run again for each reply.
import type { ChatPeriodSpec } from '../lib/chatPeriod';
export type { ChatPeriodRange, ChatPeriodSpec } from '../lib/chatPeriod';
// An Insights chart's numbers as they were when attached (lib/chartHarvest.ts).
export interface ChatChartSnapshot {
  tab: string;
  title: string;
  note: string | null;
  filters: string;
  head: string[];
  rows: Array<Array<string | number>>;
  cut: number; // rows left out
}
// A brew, bean or recipe by id; a chart with its snapshot; a period with its filters.
export interface ChatAttachmentRef {
  kind: ChatAttachmentKind;
  id: string;
  chart?: ChatChartSnapshot;
  period?: ChatPeriodSpec;
}
export interface ChatAttachment extends ChatAttachmentRef {
  label: string;
}
export interface ChatPhoto {
  id: string;
  width: number;
  height: number;
}
// A change a reply proposes, shown as a card (docs/api/chat.md §12,
// "Proposals"). Opening it fills in the brew page or the recipe form.
export type ChatProposalState = 'open' | 'dismissed';
export interface ChatProposalStep {
  stepType: StepType;
  label: string | null;
  durationSec: number | null;
  targetWaterGrams: number | null;
  targetTempC: number | null;
  pressureBar: number | null;
  flowRate: number | null;
}
// Only what the AI set.
export interface ChatProposalRecipe {
  name?: string;
  targetDoseGrams?: number;
  targetWaterGrams?: number | null;
  targetIceGrams?: number | null;
  expectedYieldGrams?: number | null;
  targetTempC?: number | null;
  expectedFinishMinSec?: number | null;
  expectedFinishMaxSec?: number | null;
  steps?: ChatProposalStep[];
}
interface ProposalBase {
  title: string;
  why: string;
  state: ChatProposalState;
}
export interface ChatBrewProposal extends ProposalBase {
  kind: 'brew';
  beanId: string | null;
  beanLabel: string | null;
  recipeId: string | null;
  recipeLabel: string | null;
  grinderId: string | null;
  grinderLabel: string | null;
  grindSetting: number | null;
  tempC: number | null;
  ratio: number | null;
}
export interface ChatRecipeChangeProposal extends ProposalBase {
  kind: 'recipeChange';
  recipeId: string;
  recipeLabel: string;
  changes: ChatProposalRecipe;
  warnings?: string[]; // step checks it fails; worth a look before saving (docs/api/chat.md §12)
}
export interface ChatNewRecipeProposal extends ProposalBase {
  kind: 'newRecipe';
  brewerId: string | null;
  brewerLabel: string | null;
  recipe: ChatProposalRecipe & { name: string; targetDoseGrams: number };
  warnings?: string[]; // step checks it fails; worth a look before saving (docs/api/chat.md §12)
}
export type ChatProposal = ChatBrewProposal | ChatRecipeChangeProposal | ChatNewRecipeProposal;

export interface ChatMessage {
  id: string;
  position: number;
  role: 'user' | 'assistant';
  content: string;
  attachments: ChatAttachment[];
  proposals: ChatProposal[];
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
// A person's own also caps a period's brews (null: the workspace's).
export interface OwnChatLimits extends ChatLimits {
  periodMaxBrews: number | null;
}
export interface ChatSettings {
  own: OwnChatLimits;
  server: ServerChatLimits;
  effective: ChatLimits;
  usedBytes: number;
}

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/chats`;

export const chatSettingsApi = {
  get: () => api.get<ChatSettings>('/api/auth/me/chat-settings'),
  save: (limits: ChatLimits & { periodMaxBrews?: number | null }) => api.put<ChatSettings>('/api/auth/me/chat-settings', limits),
  purge: () => api.delete('/api/auth/me/chats'),
};

export const chatsApi = {
  list(workspaceId: string) {
    return api.get<{ chats: Chat[]; canSend: boolean }>(base(workspaceId));
  },
  get(workspaceId: string, chatId: string) {
    return api.get<ChatPair>(`${base(workspaceId)}/${chatId}`);
  },
  summarize(workspaceId: string, chatId: string) {
    return api.post<{ chat: Chat }>(`${base(workspaceId)}/${chatId}/summary`, {});
  },
  editSummary(workspaceId: string, chatId: string, summary: string) {
    return api.put<{ chat: Chat }>(`${base(workspaceId)}/${chatId}/summary`, { summary });
  },
  clearSummary(workspaceId: string, chatId: string) {
    return api.delete<{ chat: Chat }>(`${base(workspaceId)}/${chatId}/summary`);
  },
  start(workspaceId: string, body: ChatSend) {
    return api.post<ChatPair>(base(workspaceId), body);
  },
  send(workspaceId: string, chatId: string, body: ChatSend) {
    return api.post<ChatPair>(`${base(workspaceId)}/${chatId}/messages`, body);
  },
  exportZip(workspaceId: string) {
    return api.file(`${base(workspaceId)}/export`);
  },
  importZip(workspaceId: string, zip: Blob) {
    return api.post<{ imported: number; skipped: number }>(`${base(workspaceId)}/import`, new Blob([zip], { type: 'application/zip' }));
  },
  addPhoto(workspaceId: string, image: Blob) {
    return api.post<{ photo: ChatPhoto }>(`${base(workspaceId)}/photos`, image);
  },
  photoUrl(workspaceId: string, photoId: string) {
    return `${API_URL}${base(workspaceId)}/photos/${photoId}`;
  },
  setProposal(workspaceId: string, chatId: string, messageId: string, index: number, state: ChatProposalState) {
    return api.put<{ proposals: ChatProposal[] }>(`${base(workspaceId)}/${chatId}/messages/${messageId}/proposals/${index}`, { state });
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
