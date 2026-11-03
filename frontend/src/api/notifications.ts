import { api } from './client';
import type { NotificationChannel, NotificationKind, PushDevice } from './types';

// docs/api/notifications.md §1b
const base = '/api/auth/me/notifications';

// What POST /push takes: PushSubscription.toJSON() plus a name.
export interface PushSubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  label: string;
}

export const notificationsApi = {
  list: () => api.get<{ channels: NotificationChannel[]; pushDevices: PushDevice[] }>(base),
  save: (kind: NotificationKind, input: { enabled: boolean; config: Record<string, string | null> }) =>
    api.put<{ channel: NotificationChannel }>(`${base}/${kind}`, input),
  remove: (kind: NotificationKind) => api.delete(`${base}/${kind}`),
  test: (kind: NotificationKind) => api.post<void>(`${base}/${kind}/test`),
  // Web Push ("Web Push" in §1b)
  pushKey: () => api.get<{ publicKey: string }>(`${base}/push/key`),
  subscribe: (input: PushSubscribeInput) => api.post<{ device: PushDevice }>(`${base}/push`, input),
  setDeviceEnabled: (id: string, enabled: boolean) => api.patch<{ device: PushDevice }>(`${base}/push/${id}`, { enabled }),
  removeDevice: (id: string) => api.delete(`${base}/push/${id}`),
  testDevice: (id: string) => api.post<void>(`${base}/push/${id}/test`),
};
