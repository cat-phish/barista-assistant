import { api } from './client';
import type { NotificationChannel, NotificationKind } from './types';

// docs/api/notifications.md §1b
const base = '/api/auth/me/notifications';

export const notificationsApi = {
  list: () => api.get<{ channels: NotificationChannel[] }>(base),
  save: (kind: NotificationKind, input: { enabled: boolean; config: Record<string, string | null> }) =>
    api.put<{ channel: NotificationChannel }>(`${base}/${kind}`, input),
  remove: (kind: NotificationKind) => api.delete(`${base}/${kind}`),
  test: (kind: NotificationKind) => api.post<void>(`${base}/${kind}/test`),
};
