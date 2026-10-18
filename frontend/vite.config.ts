import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Electron loads the production renderer via loadFile (file://), where
  // absolute '/assets/...' paths resolve to the drive root and 404.
  base: './',
  plugins: [react()],
});
