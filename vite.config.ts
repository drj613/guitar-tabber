import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { alphaTab } from '@coderline/alphatab-vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Copies the pdf.js data files (character maps, standard fonts, image
 * decoders, colour profiles) into public/pdfjs so they ship with the app and
 * get precached. public/pdfjs is generated, not committed.
 */
function pdfjsAssets(): Plugin {
  const copy = () => {
    const from = 'node_modules/pdfjs-dist';
    const to = 'public/pdfjs';
    mkdirSync(to, { recursive: true });
    for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      if (existsSync(`${from}/${dir}`)) cpSync(`${from}/${dir}`, `${to}/${dir}`, { recursive: true });
    }
  };
  return { name: 'pdfjs-assets', config: copy };
}

// GitHub Pages serves the site from /guitar-tabber/.
const base = process.env.BASE_PATH ?? '/guitar-tabber/';

export default defineConfig({
  base,
  plugins: [
    pdfjsAssets(),
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
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff,woff2,otf,sf2,bcmap,pfb,ttf,wasm,icc}'],
        // quickjs runs scripts embedded in PDF forms, which the viewer never needs.
        globIgnores: ['**/Bravura.svg', '**/*.eot', '**/quickjs-eval.*'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
});
