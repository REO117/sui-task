import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg'],
    manifest: {
      name: 'Sui — メモとタスク', short_name: 'Sui', lang: 'ja',
      description: 'メモとタスク', theme_color: '#f6f8fa', background_color: '#f6f8fa',
      display: 'standalone', start_url: '/', scope: '/',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
    },
    workbox: { navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] }
  })],
  server: { proxy: { '/api': 'http://127.0.0.1:8787', '/auth': 'http://127.0.0.1:8787' } }
});
