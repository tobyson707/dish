/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

const domain = fileURLToPath(new URL('./supabase/functions/_shared/domain', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@domain': domain,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      strategies: 'generateSW',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'offline.html', 'push-handler.js'],
      manifest: {
        name: 'DISH — Good food. Less thinking.',
        short_name: 'DISH',
        description: 'Plan meals, track what you eat and decide what to cook — with less thinking.',
        theme_color: '#E6E3DF',
        background_color: '#E6E3DF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['food', 'lifestyle', 'health'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Private API responses are NOT cached by the service worker;
        // user data lives in IndexedDB (see PWA_OFFLINE.md).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // only precache Latin font subsets; others load on demand if ever needed
        globIgnores: ['**/manrope-cyrillic*', '**/manrope-greek*', '**/manrope-vietnamese*', '**/*.map'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\/v1/, /^\/rest\/v1/, /^\/storage\/v1/, /^\/functions\/v1/],
        cleanupOutdatedCaches: true,
        importScripts: ['push-handler.js'],
        runtimeCaching: [
          {
            // Public catalogue images only (public bucket). Never private buckets.
            urlPattern: ({ url }) => url.pathname.includes('/storage/v1/object/public/meal-images/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'dish-meal-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    fs: { allow: ['.'] },
    // Optional same-origin proxy to a local Supabase (use VITE_SUPABASE_URL=/__supabase).
    // Not "/supabase": shared domain modules are served from /supabase/functions/… in dev.
    proxy: { '/__supabase': { target: 'http://localhost:54321', changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/__supabase/, '') } },
  },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/_shared/**/*.test.ts'],
  },
})
