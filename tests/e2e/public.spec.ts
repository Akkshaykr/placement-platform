import { expect, test } from '@playwright/test'
import { SUPABASE, expectNoHorizontalScroll } from './support'

test.describe('public pages and route protection', () => {
  test('landing page presents the product honestly', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Timed aptitude challenges')
    await expect(page.getByRole('link', { name: 'Create account' }).first()).toHaveAttribute('href', '/register')
    await expect(page.getByText('This is not a real challenge.')).toBeVisible()
    await expect(page.getByRole('main')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })

  for (const path of ['/dashboard', '/profile', '/admin']) {
    test(`signed-out visitors to ${path} are sent to sign in`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/%/g, '%')}`))
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    })
  }

  test('unknown addresses show a 404 page', async ({ page }) => {
    await page.goto('/definitely-not-a-page')
    await expect(page.getByRole('heading', { name: /can.t find that page/i })).toBeVisible()
  })

  test('sign-in validates before contacting the server', async ({ page }) => {
    let calls = 0
    await page.route(`${SUPABASE}/**`, (r) => { calls += 1; return r.abort() })
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByText('Enter your email address.')).toBeVisible()
    await expect(page.getByText('Enter your password.')).toBeVisible()
    expect(calls).toBe(0)
  })

  test('sign-in can be completed with the keyboard alone', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').focus()
    await page.keyboard.type('ada@example.test')
    await page.keyboard.press('Tab')
    await page.keyboard.type('x')
    await page.keyboard.press('Enter')
    // Reaching the network layer proves the form submitted; the fake backend is unreachable.
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('shows a clear message when the server cannot be reached', async ({ page }) => {
    await page.route(`${SUPABASE}/**`, (r) => r.abort('connectionrefused'))
    await page.goto('/login')
    await page.getByLabel('Email').fill('ada@example.test')
    await page.getByLabel('Password').fill('correct-horse-9')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(/can.t reach the server/i)
  })

  test('shows the server’s rejection of wrong credentials (mocked response)', async ({ page }) => {
    await page.route(`${SUPABASE}/auth/v1/token*`, (r) =>
      r.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) }),
    )
    await page.goto('/login')
    await page.getByLabel('Email').fill('ada@example.test')
    await page.getByLabel('Password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('The email or password is incorrect.')
  })

  test('registration enforces the password rules and matching confirmation', async ({ page }) => {
    await page.goto('/register')
    await page.getByLabel('Full name').fill('Ada Lovelace')
    await page.getByLabel('Email').fill('ada@example.test')
    await page.getByLabel('Password', { exact: true }).fill('short')
    await page.getByLabel('Confirm password').fill('different')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText('Use at least 10 characters.')).toBeVisible()
    await expect(page.getByText('The passwords do not match.')).toBeVisible()
  })

  test('registration shows a non-revealing "check your email" screen (mocked response)', async ({ page }) => {
    await page.route(`${SUPABASE}/auth/v1/signup*`, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: 'x', aud: 'authenticated', role: '', email: 'ada@example.test', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} }) }),
    )
    await page.goto('/register')
    await page.getByLabel('Full name').fill('Ada Lovelace')
    await page.getByLabel('Email').fill('ada@example.test')
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-9')
    await page.getByLabel('Confirm password').fill('correct-horse-9')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    await expect(page.getByText(/can be used for a new account/)).toBeVisible()
  })

  test('forgot-password gives the same answer for any address (mocked response)', async ({ page }) => {
    await page.route(`${SUPABASE}/auth/v1/recover*`, (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }),
    )
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill('nobody@example.test')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText(/if an account exists/i)).toBeVisible()
  })

  test('an expired reset link explains what to do', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible()
  })

  test('the callback page reports a failed sign-in instead of hanging', async ({ page }) => {
    await page.goto('/auth/callback?error=access_denied&error_description=Access+denied')
    await expect(page.getByRole('alert')).toContainText('Access denied')
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible()
  })
})

test.describe('layout on small screens', () => {
  for (const path of ['/', '/login', '/register', '/forgot-password']) {
    test(`${path} does not scroll horizontally`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading').first()).toBeVisible()
      await expectNoHorizontalScroll(page)
    })
  }
})
