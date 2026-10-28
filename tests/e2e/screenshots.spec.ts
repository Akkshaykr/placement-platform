import { test } from '@playwright/test'
import { mockBackend, signInThroughUi } from './support'

// Documentation helper, skipped in normal runs:  SCREENSHOTS=1 npx playwright test screenshots
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to regenerate docs/screenshots')

test('capture screens', async ({ page }, info) => {
  const tag = info.project.name
  const shot = (name: string) => page.screenshot({ path: `docs/screenshots/${tag}-${name}.png`, fullPage: true })
  await page.goto('/')
  await shot('landing')
  await page.goto('/login')
  await page.getByRole('heading', { name: 'Sign in' }).waitFor()
  await shot('login')
  await page.goto('/register')
  await page.getByRole('heading', { name: 'Create your account' }).waitFor()
  await shot('register')
  await mockBackend(page, { roles: ['USER', 'ADMIN'], displayName: 'Ada Lovelace', openChallenges: 3, completedAttempts: 0 })
  await page.goto('/login')
  await signInThroughUi(page)
  await page.waitForURL(/dashboard/)
  await page.getByRole('heading', { name: /Welcome/ }).waitFor()
  await shot('dashboard')
  await page.goto('/admin')
  await page.getByRole('heading', { name: 'Overview' }).waitFor()
  await shot('admin')
})
