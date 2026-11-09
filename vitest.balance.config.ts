import { defineConfig } from 'vitest/config';

// Slow, deterministic CPU-vs-CPU balance simulations: `npm run test:balance`
export default defineConfig({ test: { include: ['tests/balance/**/*.test.ts'], testTimeout: 600_000 } });
