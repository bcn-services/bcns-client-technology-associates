import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/journeys',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3100',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
