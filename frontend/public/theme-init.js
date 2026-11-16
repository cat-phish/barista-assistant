// Apply a remembered Light/Dark choice before the app loads (src/lib/theme.ts).
// A file, not inline, so the Content-Security-Policy needs no 'unsafe-inline' for scripts (SEC-34).
try {
  var t = localStorage.getItem('brewlog.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
