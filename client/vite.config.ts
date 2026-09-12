import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { assertSafeDevApiProxyTarget, resolveClientDevProxyConfig } from './dev-proxy';

export default defineConfig(({ command, mode }) => {
  const envDir = path.resolve(__dirname, '..');
  const env = loadEnv(mode, envDir, '');
  const { apiProxyTarget, vitePort } = resolveClientDevProxyConfig(env);

  if (command === 'serve') {
    assertSafeDevApiProxyTarget(apiProxyTarget, env);
  }

  return {
    envDir,
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // Point at the .ts source: the committed shared/types.js is a CommonJS
        // artifact for the server, and its named exports can't flow through
        // `export *` in dev mode.
        'shared/types': path.resolve(__dirname, '../shared/types.ts'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
              return 'react';
            }
            if (id.includes('/node_modules/@tanstack/react-query/') || id.includes('/node_modules/@tanstack/react-table/')) {
              return 'query';
            }
            if (id.includes('/node_modules/framer-motion/') || id.includes('/node_modules/lucide-react/')) {
              return 'motion';
            }
            if (id.includes('/node_modules/@radix-ui/')) {
              return 'radix';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      port: vitePort,
      proxy: {
        '/api': apiProxyTarget,
      },
    },
    // All non-API paths fall back to index.html for client-side routing
    appType: 'spa',
  };
});
