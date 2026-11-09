import { defineConfig } from 'vite';

// Served from https://<user>.github.io/mesa-de-botao/
export default defineConfig({
  base: '/mesa-de-botao/',
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
} as Parameters<typeof defineConfig>[0]);
