import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // JEDEN samowystarczalny index.html (JS+CSS inline). Kluczowe dla użycia z dysku:
  // Chromium blokuje <script type="module"> i <link crossorigin> na file:// (CORS,
  // origin null), więc rozbite assety NIE działają po podwójnym kliknięciu.
  plugins: [viteSingleFile()],
  base: './',
  build: {
    // ikony (~8 kB/szt.) MUSZĄ być inline — osobne pliki assetów złamałyby file://
    assetsInlineLimit: 32768,
  },
  resolve: {
    alias: {
      // Importujemy rdzeń bezpośrednio ze źródeł TS — dev/build nie wymaga
      // wcześniejszego `npm run build` w packages/core.
      'anonimizator/ner': fileURLToPath(new URL('../../packages/core/src/ner-client.ts', import.meta.url)),
      anonimizator: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
