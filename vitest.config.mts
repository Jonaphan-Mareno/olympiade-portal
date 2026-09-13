import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    exclude: ['tests/e2e/**', ...configDefaults.exclude],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    pool: 'threads', // explicit pool type
    coverage: {
      reporter: ['text', 'json', 'html', 'lcov'],
    },
  },
});
