import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // we show our own "Update available" banner
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pera — Budget & Money',
        short_name: 'Pera',
        description: 'Track accounts, income, expenses and transfers. Works offline.',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#141B3C',
        background_color: '#F4F6FB',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'Add expense', short_name: 'Expense', url: '/?add=expense', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Add income', short_name: 'Income', url: '/?add=income', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Dashboard', short_name: 'Dashboard', url: '/', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }
        ]
      },
      workbox: {
        // App shell + static assets are precached; versioned by build hash, old caches cleaned.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\/v1/, /^\/rest\/v1/],
                cleanupOutdatedCaches: true,
        importScripts: ['push-sw.js'], // push notification handlers (public/push-sw.js)
        // Never cache Supabase API responses — financial data lives in IndexedDB, not the HTTP cache.
        runtimeCaching: []
      },
      devOptions: { enabled: false }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        // Vendor chunks change rarely, so app updates only re-download our own code.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@supabase')) return 'vendor-supabase';
          if (id.includes('dexie')) return 'vendor-dexie';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
          return 'vendor';
        }
      }
    }
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js']
  }
});
