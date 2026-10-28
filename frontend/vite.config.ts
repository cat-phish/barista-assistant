import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// PWA settings follow docs/timer_architecture.md §2.
export default defineConfig({
  server: {
    // The app calls /api on its own origin; the dev server forwards it, so it
    // works from any address (localhost, the LAN IP from a phone) without CORS.
    // xfwd passes the client IP on (the backend trusts one proxy, TRUST_PROXY).
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', xfwd: true },
    },
    // IPs and localhost always work; a hostname (e.g. barista.lan) must be
    // listed: ALLOWED_HOSTS=barista.lan,other.lan
    allowedHosts: process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',').map((h) => h.trim()) : [],
    // Vite reloads the page when its live-reload socket drops and comes back,
    // which on a phone happens whenever the camera or photo picker opens:
    // whatever was in progress is lost. Docker sets VITE_LIVE_RELOAD=false
    // (its source is copied in, so live reload does nothing there).
    ws: process.env.VITE_LIVE_RELOAD === 'false' ? false : undefined,
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Coffee Brew Journal',
        short_name: 'BrewLog',
        description: 'Self-hosted pour-over timer and LLM extraction analysis',
        theme_color: '#3e2723',
        background_color: '#f5f5f5',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // App routes (the guest menu at /menu/:slug too) load the cached shell
        // offline; API addresses opened directly are never answered with it.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\/public\/menu\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'public-menu-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Bean photos never change for an id (docs/api/bean-photos.md
            // §4c): kept once seen, so they show offline too.
            urlPattern: /\/api\/workspaces\/[^/]+\/beans\/[^/]+\/photos\/[^/]+$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bean-photos',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});
