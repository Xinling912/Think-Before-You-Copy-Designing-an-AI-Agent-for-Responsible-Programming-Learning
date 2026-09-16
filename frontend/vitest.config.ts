import react from '@vitejs/plugin-react';
import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    exclude: [...defaultExclude, 'tests/**/*.spec.ts'],
    globals: true,
    setupFiles: './vitest.setup.ts',
  },
});
