import { expect, test } from '@playwright/test'
import { adminStats, expectNoHorizontalScroll, mockBackend, signInThroughUi } from './support'

// Network responses are mocked in this file: it verifies how the UI behaves for a student and for
// an administrator, NOT that a real Supabase project issues these responses.

test.describe('student session (mocked backend)', () => {
  test('signs in and sees real-count dashboard cards', async ({ page }) => {
    await mockBackend(page, { openChallenges: 3, completedAttempts: 0 })
    await page.goto('/login')
    await signInThroughUi(page)
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('heading', { name: 'Welcome, Ada' })).toBeVisible()
    await expect(page.getByText('3', { exact: true })).toBeVisible()
    await expect(page.getByText('You haven’t completed an attempt yet')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  test('returns to the page that required sign-in', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login\?next=%2Fprofile/)
    await signInThroughUi(page)
    await expect(page).toHaveURL(/\/profile$/)
  })

  test('ignores an external ?next= target (open-redirect protection)', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/login?next=https%3A%2F%2Fevil.example.test%2F')
    await signInThroughUi(page)
    await expect(page).toHaveURL(/localhost:\d+\/dashboard$/)
  })

  test('keeps the session across a reload', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/login')
    await signInThroughUi(page)
    await expect(page).toHaveURL(/\/dashboard$/)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Welcome, Ada' })).toBeVisible()
  })

  test('a student cannot open the admin area, and never sees an admin link', async ({ page }) => {
    const { seen } = await mockBackend(page, { roles: ['USER'] })
    await page.goto('/login')
    await signInThroughUi(page)
    await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: /don.t have access/i })).toBeVisible()
    // The admin page's code and data are never requested for a student.
    expect(seen.some((s) => s.includes('admin_overview_stats'))).toBe(false)
  })

  test('profile edits are saved and confirmed', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/profile')
    await signInThroughUi(page)
    const save = page.getByRole('button', { name: 'Save changes' })
    await expect(save).toBeDisabled()
    await page.getByLabel('Display name').fill('Ada L.')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(page.getByRole('status').filter({ hasText: 'Profile updated.' })).toBeVisible()
  })

  test('signing out returns to the home page and protects the dashboard again', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/login')
    await signInThroughUi(page)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/localhost:\d+\/$/)
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible()
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/)
  })
})

test.describe('administrator session (mocked backend)', () => {
  test('sees the overview with definitions and distinct attempt/participant metrics', async ({ page }) => {
    await mockBackend(page, { roles: ['USER', 'ADMIN'], displayName: 'Owner' })
    await page.goto('/login')
    await signInThroughUi(page)
    await page.getByRole('link', { name: 'Admin', exact: true }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
    await expect(page.getByText('Administrator', { exact: true })).toBeVisible()
    await expect(page.getByText(String(adminStats.completed_attempts), { exact: true })).toBeVisible()
    await expect(page.getByText(String(adminStats.unique_participants), { exact: true })).toBeVisible()
    await expect(page.getByText('Distinct people with at least one submitted attempt.')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})
