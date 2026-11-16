import { api } from './client';
import type { AiPreferences, AiPreferencesSettings, AiPrompt, AiPromptSettings, User, UserPreferences } from './types';

export const authApi = {
  me: () => api.get<{ user: User }>('/api/auth/me'),
  login: (email: string, password: string) => api.post<{ user: User }>('/api/auth/login', { email, password }),
  register: (email: string, password: string) => api.post<{ user: User } | { pending: true }>('/api/auth/register', { email, password }),
  // Whether this server takes new accounts (ALLOW_REGISTRATION, §1).
  registration: () => api.get<{ open: boolean; inviteOnly: boolean; emailVerification: boolean }>('/api/auth/registration'),
  // §1e, only on servers with EMAIL_VERIFICATION on: mail me a link / redeem the link's token.
  sendVerification: () => api.post<void>('/api/auth/verify-email/send'),
  verifyEmail: (token: string) => api.post<void>('/api/auth/verify-email', { token }),
  logout: () => api.post<void>('/api/auth/logout'),
  // Any subset; the response is the whole set, defaults filled in.
  setPreferences: (changes: Partial<UserPreferences>) => api.patch<{ preferences: UserPreferences }>('/api/auth/me/preferences', changes),
  // docs/api/auth.md §1: logs out the caller's other sessions; this one gets a fresh cookie.
  changePassword: (currentPassword: string, newPassword: string) => api.post<void>('/api/auth/password', { currentPassword, newPassword }),
  // 409 while the caller is the only owner of a workspace (body.workspaces lists them).
  deleteAccount: (password: string) => api.delete('/api/auth/me', { password }),
  // Your own AI prompt (§1c), with the default sections to show.
  aiPrompt: () => api.get<AiPromptSettings>('/api/auth/me/ai-prompt'),
  setAiPrompt: (prompt: AiPrompt) => api.put<AiPromptSettings>('/api/auth/me/ai-prompt', prompt),
  // Learned preferences (docs/api/auth.md §1d).
  aiPreferences: () => api.get<AiPreferencesSettings>('/api/auth/me/ai-preferences'),
  setAiPreferences: (body: { learn: AiPreferences['learn']; apply: AiPreferences['apply']; items: Array<{ id?: string; text: string }> }) =>
    api.put<AiPreferencesSettings>('/api/auth/me/ai-preferences', body),
  answerProposal: (id: string, action: 'accept' | 'dismiss') => api.post<AiPreferencesSettings>(`/api/auth/me/ai-preferences/proposals/${encodeURIComponent(id)}/${action}`),
  learnNow: (workspaceId: string) => api.post<{ queued: true }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/ai-preferences/update`),
};
