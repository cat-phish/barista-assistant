// The Theme preference (docs/api/auth.md §1): "light" or "dark" set
// data-theme on <html>; "system" removes it and base.css follows the device
// (prefers-color-scheme). Remembered on the device too, so index.html can
// apply it before the app loads (no light flash) and the login screen keeps it.
import type { Theme } from '../api/types';

export const THEME_KEY = 'brewlog.theme';
const BAR_COLOR = { light: '#3e2723', dark: '#1e1e1e' }; // the phone's status bar

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? BAR_COLOR.dark : BAR_COLOR.light);
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not remembering it on this device is fine; the account still has it.
  }
}
