import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Importujemy rdzeń bezpośrednio ze źródeł TS — dev/build nie wymaga
      // wcześniejszego `npm run build` w packages/core.
      anonimizator: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
