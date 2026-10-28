import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

type Listener = (event: string, session: unknown) => void
const state = vi.hoisted(() => ({
  session: null as unknown,
  roles: { data: [{ role: 'USER' }] as unknown, error: null as unknown },
  profile: { data: { id: 'u1', display_name: 'Ada', avatar_url: null } as unknown, error: null as unknown },
  listener: null as Listener | null,
  queried: [] as string[],
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: (cb: Listener) => {
        state.listener = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => {
      state.queried.push(table)
      const result = table === 'user_roles' ? state.roles : state.profile
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => result, then: (r: (v: unknown) => unknown) => r(result) }
      return chain
    },
  }),
}))

const session = (id = 'u1') => ({ user: { id, email: 'ada@example.test' } })

function Probe() {
  const a = useAuth()
  return (
    <ul>
      <li data-testid="status">{a.status}</li>
      <li data-testid="roles-status">{a.rolesStatus}</li>
      <li data-testid="admin">{String(a.isAdmin)}</li>
      <li data-testid="roles">{a.roles.join(',')}</li>
      <li data-testid="name">{a.profile?.display_name ?? ''}</li>
      <li data-testid="recovering">{String(a.recovering)}</li>
    </ul>
  )
}

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )

beforeEach(() => {
  state.session = null
  state.roles = { data: [{ role: 'USER' }], error: null }
  state.profile = { data: { id: 'u1', display_name: 'Ada', avatar_url: null }, error: null }
  state.listener = null
  state.queried = []
})

describe('AuthProvider', () => {
  it('reports signed-out without querying the database', async () => {
    mount()
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(screen.getByTestId('roles-status')).toHaveTextContent('idle')
    expect(state.queried).toEqual([])
  })

  it('loads roles and profile for a student; isAdmin stays false', async () => {
    state.session = session()
    mount()
    await waitFor(() => expect(screen.getByTestId('roles-status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(screen.getByTestId('admin')).toHaveTextContent('false')
    expect(screen.getByTestId('roles')).toHaveTextContent('USER')
    expect(screen.getByTestId('name')).toHaveTextContent('Ada')
  })

  it('recognises an administrator from the server-provided roles', async () => {
    state.session = session()
    state.roles = { data: [{ role: 'USER' }, { role: 'ADMIN' }], error: null }
    mount()
    await waitFor(() => expect(screen.getByTestId('admin')).toHaveTextContent('true'))
  })

  it('fails closed when the roles request errors', async () => {
    state.session = session()
    state.roles = { data: null, error: { message: 'boom' } }
    mount()
    // The provider retries once (1s delay) before giving up, so allow for that.
    await waitFor(() => expect(screen.getByTestId('roles-status')).toHaveTextContent('error'), { timeout: 4000 })
    expect(screen.getByTestId('admin')).toHaveTextContent('false')
  })

  it('fails closed when the roles payload is not what the schema expects', async () => {
    state.session = session()
    state.roles = { data: [{ role: 'SUPERUSER' }], error: null }
    mount()
    // The provider retries once (1s delay) before giving up, so allow for that.
    await waitFor(() => expect(screen.getByTestId('roles-status')).toHaveTextContent('error'), { timeout: 4000 })
    expect(screen.getByTestId('admin')).toHaveTextContent('false')
  })

  it('reacts to auth events: sign-in, password recovery and sign-out', async () => {
    mount()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))

    await act(async () => state.listener?.('SIGNED_IN', session()))
    await waitFor(() => expect(screen.getByTestId('roles-status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')

    await act(async () => state.listener?.('PASSWORD_RECOVERY', session()))
    expect(screen.getByTestId('recovering')).toHaveTextContent('true')

    await act(async () => state.listener?.('SIGNED_OUT', null))
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    expect(screen.getByTestId('admin')).toHaveTextContent('false')
    expect(screen.getByTestId('recovering')).toHaveTextContent('false')
  })
})
