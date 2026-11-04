import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against a production build (`vite preview`) talking to
// the local Supabase stack (`npm run stack:up`). Mailpit (:8025) receives the
// verification emails so the real sign-up flow is exercised.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [
    { name: 'android-small', use: { ...devices['Galaxy S9+'], viewport: { width: 360, height: 740 } } },
    // iPhone / iPad viewports rendered in Chromium (WebKit isn't required to check layout)
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium' }, grep: /@responsive/ },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'], browserName: 'chromium', defaultBrowserType: 'chromium' }, grep: /@responsive/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } }, grep: /@responsive/ },
  ],
})
