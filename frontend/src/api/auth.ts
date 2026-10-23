import { api } from './client';
import type { User, UserPreferences } from './types';

export const authApi = {
  me: () => api.get<{ user: User }>('/api/auth/me'),
  login: (email: string, password: string) => api.post<{ user: User }>('/api/auth/login', { email, password }),
  register: (email: string, password: string) => api.post<{ user: User }>('/api/auth/register', { email, password }),
  logout: () => api.post<void>('/api/auth/logout'),
  // Any subset; the response is the whole set, defaults filled in.
  setPreferences: (changes: Partial<UserPreferences>) => api.patch<{ preferences: UserPreferences }>('/api/auth/me/preferences', changes),
  // docs/api/auth.md §1: logs out the caller's other sessions; this one gets a fresh cookie.
  changePassword: (currentPassword: string, newPassword: string) => api.post<void>('/api/auth/password', { currentPassword, newPassword }),
  // 409 while the caller is the only owner of a workspace (body.workspaces lists them).
  deleteAccount: (password: string) => api.delete('/api/auth/me', { password }),
};
