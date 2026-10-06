import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The landing is a static site. It shares the app's fonts, logo and real demo media instead of
// keeping copies that could drift (publicDir points at the app's public folder).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: '../web/public',
});
