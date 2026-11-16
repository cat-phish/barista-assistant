// SEC-38 (audit/findings/R2-ai.md): the service worker's bean-photos cache
// (vite.config.ts, CacheFirst, a year) is served without the backend, so it
// must go when the person signs out. Fails until the store clears it.
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/auth', () => ({ authApi: { logout: vi.fn(async () => undefined) } }));

import { useAuthStore } from './auth';

const deleted = vi.fn(async (_name: string) => true);

beforeEach(() => {
  setActivePinia(createPinia());
  deleted.mockClear();
  vi.stubGlobal('caches', { delete: deleted });
});

describe('SEC-38: bean-photos cache is cleared when the session ends', () => {
  it('on logout', async () => {
    await useAuthStore().logout();
    expect(deleted).toHaveBeenCalledWith('bean-photos');
  });

  it('when the server says the session is gone', async () => {
    useAuthStore().sessionEnded();
    await Promise.resolve();
    expect(deleted).toHaveBeenCalledWith('bean-photos');
  });
});
