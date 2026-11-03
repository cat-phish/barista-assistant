// @ts-check
/// <reference lib="webworker" />
// Web Push in the service worker (docs/api/notifications.md §1b, "Web Push").
// Loaded by the generated service worker (importScripts in vite.config.ts).
// Plain JS: it's copied as is, not built.
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

// The payload is { title, message, url }, url possibly null.
sw.addEventListener('push', (event) => {
  /** @type {{ title?: string, message?: string, url?: string | null }} */
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { message: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    sw.registration.showNotification(data.title || 'Barista-Assistant', {
      body: data.message || '',
      icon: '/pwa-192x192.png',
      data: { url: data.url || '/' },
    }),
  );
});

// Tapping it opens its link: in an open window through the app's router (so
// a brew in progress asks before leaving), else in a new one.
sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', sw.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === sw.location.origin);
      if (open && target.origin === sw.location.origin) {
        await open.focus();
        open.postMessage({ type: 'open-path', path: target.pathname + target.search + target.hash });
        return;
      }
      await sw.clients.openWindow(target.href);
    })(),
  );
});
