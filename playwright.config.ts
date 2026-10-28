import { defineConfig, devices } from '@playwright/test'

// The app is started with a syntactically valid but fake Supabase address. Nothing listens there,
// so tests either exercise code that needs no backend, or intercept the network calls explicitly
// (see tests/e2e/support.ts). These tests therefore verify the UI wiring, NOT a live Supabase project.
const CONFIGURED_PORT = 5180
const UNCONFIGURED_PORT = 5181

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${CONFIGURED_PORT}` } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], baseURL: `http://localhost:${CONFIGURED_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npx vite --port ${CONFIGURED_PORT} --strictPort`,
      url: `http://localhost:${CONFIGURED_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_placeholder_key',
        VITE_APP_URL: '',
      },
    },
    {
      command: `npx vite --port ${UNCONFIGURED_PORT} --strictPort`,
      url: `http://localhost:${UNCONFIGURED_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_APP_URL: '' },
    },
  ],
})
