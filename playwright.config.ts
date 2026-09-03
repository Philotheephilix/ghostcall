import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    baseURL: 'http://localhost:3333',
  },
  webServer: {
    command: 'python3 -m http.server 3333 --directory renderer/out',
    url: 'http://localhost:3333',
    reuseExistingServer: false,
    timeout: 10000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
