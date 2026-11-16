import { defineStore } from 'pinia';
import { ref } from 'vue';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';
import type { User, UserPreferences } from '../api/types';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  // Whether we've asked the server who's logged in yet (on first navigation).
  const checked = ref(false);

  async function fetchMe(): Promise<void> {
    try {
      user.value = (await authApi.me()).user;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
      user.value = null;
    } finally {
      checked.value = true;
    }
  }

  async function login(email: string, password: string): Promise<void> {
    user.value = (await authApi.login(email, password)).user;
  }

  // true: signed in; false: the server wants the email confirmed first and
  // answers the same for a taken address (docs/api/auth.md §1, 202).
  async function register(email: string, password: string): Promise<boolean> {
    const res = await authApi.register(email, password);
    if ('user' in res) {
      user.value = res.user;
      return true;
    }
    return false;
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } finally {
      user.value = null;
    }
  }

  async function setPreferences(changes: Partial<UserPreferences>): Promise<void> {
    const { preferences } = await authApi.setPreferences(changes);
    if (user.value) user.value = { ...user.value, preferences };
  }

  // The server said the session is gone (401 on some request).
  function sessionEnded(): void {
    user.value = null;
  }

  return { user, checked, fetchMe, login, register, logout, setPreferences, sessionEnded };
});
