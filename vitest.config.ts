import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@main': r('./src/main'),
      // Testy uruchamiają moduły procesu głównego w zwykłym Node,
      // więc `electron` podmieniamy na atrapę.
      electron: r('./tests/stubs/electron.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**', 'src/shared/**'],
    },
  },
});
