import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// Landing „Parawan" — JEDEN samowystarczalny index.html (JS+CSS+fonty+SVG inline).
// Świadomie ta sama filozofia co narzędzie (apps/web): strona nie robi ŻADNYCH żądań
// do serwerów firm trzecich — to weryfikowalna obietnica (DevTools → Network: 0 żądań),
// a plik działa też z file:// po podwójnym kliknięciu.
export default defineConfig({
  plugins: [viteSingleFile()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  build: {
    // Fonty marki (Archivo ~35 kB/podzbiór, IBM Plex Mono ~15 kB/waga) muszą trafić inline.
    assetsInlineLimit: 262144,
  },
  resolve: {
    alias: {
      // Live demo importuje silnik redakcji PROSTO ze źródeł rdzenia — bez pre-buildu
      // packages/core (jak apps/web). Vite wtapia go do jednego pliku.
      anonimizator: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
