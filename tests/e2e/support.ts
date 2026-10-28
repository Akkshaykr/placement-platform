import type { Page, Route } from '@playwright/test'

/**
 * Network interception for the fake Supabase address. Everything here is a MOCK: it proves how the
 * UI reacts to responses, not that a real Supabase project behaves this way.
 */
export const SUPABASE = 'http://127.0.0.1:54321'

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')

export interface MockUser {
  id?: string
  email?: string
  displayName?: string
  roles?: Array<'USER' | 'ADMIN'>
  openChallenges?: number
  completedAttempts?: number
}

export const adminStats = {
  registered_users: 12,
  published_challenges: 4,
  challenges_in_preparation: 2,
  completed_attempts: 30,
  unique_participants: 9,
  open_reports: 1,
}

function sessionFor(user: Required<Pick<MockUser, 'id' | 'email'>>) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', exp })}.mock-signature`
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'mock-refresh-token',
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  }
}

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) })

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
}

/** Mocks sign-in and the REST calls the app makes for a given person. */
export async function mockBackend(page: Page, user: MockUser = {}) {
  const u = {
    id: user.id ?? '11111111-1111-4111-8111-111111111111',
    email: user.email ?? 'ada@example.test',
    displayName: user.displayName ?? 'Ada',
    roles: user.roles ?? ['USER'],
    openChallenges: user.openChallenges ?? 3,
    completedAttempts: user.completedAttempts ?? 0,
  }
  const seen: string[] = []

  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    seen.push(`${req.method()} ${path}`)

    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })

    if (path === '/auth/v1/token') return json(route, sessionFor(u))
    if (path === '/auth/v1/user') return json(route, sessionFor(u).user)
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors })

    if (path === '/rest/v1/user_roles') return json(route, u.roles.map((role) => ({ role })))
    if (path === '/rest/v1/profiles') {
      if (req.method() === 'PATCH') return route.fulfill({ status: 204, headers: cors })
      const row = { id: u.id, display_name: u.displayName, avatar_url: null }
      const wantsObject = (req.headers()['accept'] ?? '').includes('pgrst.object')
      return json(route, wantsObject ? row : [row])
    }
    if (path === '/rest/v1/challenges') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `*/${u.openChallenges}`, 'access-control-expose-headers': 'content-range' } })
    if (path === '/rest/v1/challenge_attempts') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `*/${u.completedAttempts}`, 'access-control-expose-headers': 'content-range' } })
    if (path === '/rest/v1/rpc/admin_overview_stats') {
      // Mirrors the database: only an administrator gets data.
      return u.roles.includes('ADMIN')
        ? json(route, adminStats)
        : json(route, { code: '42501', message: 'Administrator access required.' }, 403)
    }
    return json(route, { message: `unmocked ${req.method()} ${path}` }, 404)
  })

  return { user: u, seen }
}

export async function signInThroughUi(page: Page, email = 'ada@example.test') {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('correct-horse-9')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 0) throw new Error(`Page scrolls horizontally by ${overflow}px`)
}
