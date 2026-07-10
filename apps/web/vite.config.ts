import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // JEDEN samowystarczalny index.html (JS+CSS inline). Kluczowe dla użycia z dysku:
  // Chromium blokuje <script type="module"> i <link crossorigin> na file:// (CORS,
  // origin null), więc rozbite assety NIE działają po podwójnym kliknięciu.
  plugins: [
    viteSingleFile(),
    {
      // Edycja „urzędnik": oznacz <html>, by CSS ukrył elementy [data-full] (warstwa AI/NER)
      // JUŻ przy pierwszym malowaniu — bez mignięcia zanim JS zdąży je usunąć z DOM.
      name: 'edition-attr',
      transformIndexHtml(html: string) {
        return process.env.VITE_EDITION === 'urzednik'
          ? html.replace('<html lang="pl">', '<html lang="pl" data-hide-full>')
          : html;
      },
    },
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  build: {
    // ikony (~8 kB/szt.) MUSZĄ być inline — osobne pliki assetów złamałyby file://
    assetsInlineLimit: 32768,
  },
  resolve: {
    alias: {
      // Importujemy rdzeń bezpośrednio ze źródeł TS — dev/build nie wymaga
      // wcześniejszego `npm run build` w packages/core.
      'anonimizator/ner-postprocess': fileURLToPath(
        new URL('../../packages/core/src/ner-postprocess.ts', import.meta.url),
      ),
      'anonimizator/ner': fileURLToPath(new URL('../../packages/core/src/ner-client.ts', import.meta.url)),
      anonimizator: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
