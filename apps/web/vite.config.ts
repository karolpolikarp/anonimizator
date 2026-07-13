import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // JEDEN samowystarczalny index.html (JS+CSS inline). Kluczowe dla użycia z dysku:
  // Chromium blokuje <script type="module"> i <link crossorigin> na file:// (CORS,
  // origin null), więc rozbite assety NIE działają po podwójnym kliknięciu.
  plugins: [viteSingleFile()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  build: {
    // WSZYSTKIE assety MUSZĄ być inline (data:) — osobny plik assetu złamałby file://
    // (Chromium blokuje pobocze przy origin null). Limit obejmuje też fonty marki
    // (Archivo ~35 kB/podzbiór, IBM Plex Mono ~15 kB/waga) — stąd zapas 256 kB.
    assetsInlineLimit: 262144,
  },
  resolve: {
    alias: {
      // Importujemy rdzeń bezpośrednio ze źródeł TS — dev/build nie wymaga
      // wcześniejszego `npm run build` w packages/core.
      anonimizator: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
