import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173/mesa-de-botao/',
    trace: 'off',
    // Local sandboxes can point at a pre-installed Chromium; CI uses `playwright install`.
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
      : {},
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/mesa-de-botao/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
