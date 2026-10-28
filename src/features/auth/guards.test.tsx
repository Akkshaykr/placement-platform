import { render, screen } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AuthContext, type AuthContextValue } from './authContext'
import { RedirectIfAuthenticated, RequireAdmin, RequireAuth } from './guards'

const base: AuthContextValue = {
  status: 'authenticated',
  session: null,
  user: null,
  roles: ['USER'],
  rolesStatus: 'ready',
  isAdmin: false,
  profile: null,
  recovering: false,
  retryRoles: () => {},
  signOut: async () => {},
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>
}

function renderAt(path: string, auth: Partial<AuthContextValue>) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <><p>login page</p><Where /></> },
      { path: '/dashboard', element: <><p>dashboard page</p><Where /></> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/profile', element: <p>profile page</p> },
          { element: <RequireAdmin />, children: [{ path: '/admin', element: <p>admin page</p> }] },
        ],
      },
      { element: <RedirectIfAuthenticated />, children: [{ path: '/register', element: <Outlet /> }] },
      { path: '/reset', element: <RedirectIfAuthenticated allowRecovery />, children: [{ index: true, element: <p>reset page</p> }] },
    ],
    { initialEntries: [path] },
  )
  return render(
    <AuthContext.Provider value={{ ...base, ...auth }}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  )
}

describe('RequireAuth', () => {
  it('shows a loading state while the session is being restored (no redirect flash)', () => {
    renderAt('/profile', { status: 'loading' })
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
  })

  it('sends signed-out visitors to /login and remembers where they were going', () => {
    renderAt('/profile', { status: 'unauthenticated' })
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/login?next=%2Fprofile')
  })

  it('lets signed-in users through', () => {
    renderAt('/profile', {})
    expect(screen.getByText('profile page')).toBeInTheDocument()
  })
})

describe('RequireAdmin', () => {
  it('shows the forbidden page to a student', () => {
    renderAt('/admin', { isAdmin: false })
    expect(screen.getByRole('heading', { name: /don.t have access/i })).toBeInTheDocument()
    expect(screen.queryByText('admin page')).not.toBeInTheDocument()
  })

  it('waits for roles before deciding, so an admin never sees a "forbidden" flash', () => {
    renderAt('/admin', { rolesStatus: 'loading', isAdmin: false })
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /access/i })).not.toBeInTheDocument()
  })

  it('offers a retry when roles cannot be loaded, instead of claiming "forbidden"', () => {
    renderAt('/admin', { rolesStatus: 'error' })
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t check your permissions/i)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('renders the admin page for an administrator', () => {
    renderAt('/admin', { isAdmin: true, roles: ['USER', 'ADMIN'] })
    expect(screen.getByText('admin page')).toBeInTheDocument()
  })

  it('sends a signed-out visitor to login before it ever evaluates roles', () => {
    renderAt('/admin', { status: 'unauthenticated', rolesStatus: 'idle' })
    expect(screen.getByText('login page')).toBeInTheDocument()
  })
})

describe('RedirectIfAuthenticated', () => {
  it('redirects signed-in users away from /register, honouring only a safe ?next=', () => {
    renderAt('/register?next=%2Fprofile', {})
    expect(screen.getByText('profile page')).toBeInTheDocument()
  })

  it('ignores an external ?next= and falls back to the dashboard', () => {
    renderAt('/register?next=https%3A%2F%2Fevil.example.test', {})
    expect(screen.getByText('dashboard page')).toBeInTheDocument()
  })

  it('keeps people on the reset screen after a recovery link', () => {
    renderAt('/reset', { recovering: true })
    expect(screen.getByText('reset page')).toBeInTheDocument()
  })
})
