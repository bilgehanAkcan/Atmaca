import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { randomBytes } from 'node:crypto';

const nonce = randomBytes(24).toString('base64');

export default defineConfig({
  base: './', // Electron loadFile / file:// için göreli derleme yolları.
  html: { cspNonce: nonce },
  plugins: [react(), tailwindcss(), {
    name: 'html-csp-nonce',
    transformIndexHtml(html) {
      return html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
    },
  }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, open: false },
});
