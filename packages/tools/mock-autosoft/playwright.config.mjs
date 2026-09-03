import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'test.mjs',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],

  use: {
    trace: 'on',
    video: 'on',
    viewport: { width: 1280, height: 720 },
  },

  webServer: {
    command: 'node serve.mjs',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    stdout: 'pipe',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
