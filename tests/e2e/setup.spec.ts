import { expect, test } from '@playwright/test'

// Port 5181 runs the app WITHOUT Supabase configuration (see playwright.config.ts).
test('refuses to start without configuration and explains how to fix it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5181/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('isn’t configured yet')
  await expect(page.getByText('VITE_SUPABASE_URL is not set.')).toBeVisible()
  await expect(page.getByText('VITE_SUPABASE_PUBLISHABLE_KEY is not set.')).toBeVisible()
  expect(errors).toEqual([])
})
