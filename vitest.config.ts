import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@opencode-ai/sdk': new URL('./node_modules/@opencode-ai/sdk/dist/index.js', import.meta.url).pathname,
    },
    conditions: ['import', 'node'],
  },
  define: {
    'process.env.NODE_ENV': '"test"',
  },
});