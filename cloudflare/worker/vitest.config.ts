import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': new URL('./tests/cloudflare-workers-shim.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/index.ts',
        'src/**/*.config.{ts,js}',
        'src/**/__tests__/**',
      ],
      // Debt: https://github.com/sass-maker/knowledge-base/issues/33
      thresholds: {
        branches: 48,
        lines: 55,
        functions: 55,
        statements: 53,
      },
    },
  },
});
