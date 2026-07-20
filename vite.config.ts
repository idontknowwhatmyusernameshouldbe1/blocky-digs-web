import { defineConfig } from 'vite';

// Repo name → https://<user>.github.io/blocky-digs-web/
export default defineConfig({
  base: '/blocky-digs-web/',
  server: {
    port: 5173,
    host: true,
  },
});
