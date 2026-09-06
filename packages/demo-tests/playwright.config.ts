import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }]],

  use: {
    browserName: 'chromium',
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
    baseURL: 'http://localhost:3456',
    trace: 'on',
    video: 'on',
  },

  webServer: {
    command: 'node ../demo-app/server.mjs',
    url: 'http://localhost:3456',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
