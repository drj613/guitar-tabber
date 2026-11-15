import { defineConfig } from 'vite';
import { alphaTab } from '@coderline/alphatab-vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the site from /guitar-tabber/.
const base = process.env.BASE_PATH ?? '/guitar-tabber/';

export default defineConfig({
  base,
  plugins: [
    alphaTab(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Guitar Tabber',
        short_name: 'Tabber',
        description: 'Offline Guitar Pro tab player',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1c1b22',
        theme_color: '#1c1b22',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell plus everything alphaTab loads at runtime: worker and
        // worklet chunks, the music font and the soundfont.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff,woff2,otf,sf2}'],
        globIgnores: ['**/Bravura.svg', '**/*.eot'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
});
