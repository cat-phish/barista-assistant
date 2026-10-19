import { api } from './client';
import type { User } from './types';

export const authApi = {
  me: () => api.get<{ user: User }>('/api/auth/me'),
  login: (email: string, password: string) => api.post<{ user: User }>('/api/auth/login', { email, password }),
  register: (email: string, password: string) => api.post<{ user: User }>('/api/auth/register', { email, password }),
  logout: () => api.post<void>('/api/auth/logout'),
};
