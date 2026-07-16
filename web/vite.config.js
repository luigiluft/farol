// A TORRE - config Vite (scaffold).
// Proxy /api -> server express na 7777 (dev). Em prod o express serve web/dist.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Code-split do bundle principal (estava 860KB min). SO vendor:
        // imports continuam ESTATICOS (chunks entram como <link modulepreload>
        // em paralelo — zero waterfall no hot path do canvas/universo).
        // d3 esta no package.json mas nao e importado em src/ => fora do grafo,
        // nada a splitar. Deps transitivas (unified/lowlight/highlight.js) sao
        // absorvidas pelo Rollup no chunk do seu unico consumidor.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'scheduler'],
          markdown: ['react-markdown', 'remark-gfm', 'rehype-highlight'],
        },
      },
    },
  },
  server: {
    proxy: {
      // TORRE_API so para dev/teste contra instancia efemera; default = prod 7777.
      '/api': process.env.TORRE_API || 'http://localhost:7777',
    },
  },
});
