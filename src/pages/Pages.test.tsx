import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../tests/unit/utils'
import { AuthContext, type AuthContextValue } from '@/features/auth/authContext'
import { AdminOverviewPage } from '@/features/admin/AdminOverviewPage'
import * as adminApi from '@/features/admin/api'
import { StudentDashboardPage } from '@/features/dashboard/StudentDashboardPage'
import * as dashApi from '@/features/dashboard/api'
import { LandingPage } from './LandingPage'
import { SetupRequiredPage } from './SetupRequiredPage'

vi.mock('@/features/admin/api')
vi.mock('@/features/dashboard/api')

const auth: AuthContextValue = {
  status: 'authenticated', session: null, user: null, roles: ['USER'], rolesStatus: 'ready', isAdmin: false,
  profile: { id: 'u1', display_name: 'Ada', avatar_url: null }, recovering: false, retryRoles: () => {}, signOut: async () => {},
}
const withAuth = (ui: React.ReactElement, over: Partial<AuthContextValue> = {}) => (
  <AuthContext.Provider value={{ ...auth, ...over }}>{ui}</AuthContext.Provider>
)

beforeEach(() => vi.resetAllMocks())

describe('LandingPage', () => {
  it('invites visitors to register or sign in, and labels the specimen as an example', () => {
    renderWithProviders(withAuth(<LandingPage />, { status: 'unauthenticated' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vanakkam Students Apttitude Challenge ku Readya ???')
    expect(screen.getByRole('link', { name: /create account/i })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
    expect(screen.getByText(/not a real challenge/i)).toBeInTheDocument()
  })

  it('does not invent statistics or testimonials', () => {
    const { container } = renderWithProviders(withAuth(<LandingPage />, { status: 'unauthenticated' }))
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\d[\d,]*\+?\s*(students|users|learners|challenges|questions|attempts)/i)
    expect(text).not.toMatch(/testimonial|trusted by|join thousands/i)
  })

  it('points signed-in users to their dashboard', () => {
    renderWithProviders(withAuth(<LandingPage />))
    expect(screen.getByRole('link', { name: /go to your dashboard/i })).toHaveAttribute('href', '/dashboard')
  })
})

describe('StudentDashboardPage', () => {
  it('shows real counts and the empty state for a new student', async () => {
    vi.mocked(dashApi.countOpenChallenges).mockResolvedValue(3)
    vi.mocked(dashApi.countCompletedAttempts).mockResolvedValue(0)
    renderWithProviders(withAuth(<StudentDashboardPage />))
    expect(await screen.findByText('3')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /welcome, ada/i })).toBeInTheDocument()
    expect(await screen.findByText(/haven.t completed an attempt yet/i)).toBeInTheDocument()
  })

  it('shows an error on the affected card instead of a fake zero', async () => {
    vi.mocked(dashApi.countOpenChallenges).mockRejectedValue(new Error('network'))
    vi.mocked(dashApi.countCompletedAttempts).mockResolvedValue(5)
    renderWithProviders(withAuth(<StudentDashboardPage />))
    expect(await screen.findByText(/couldn.t load this figure/i)).toBeInTheDocument()
    expect(screen.queryByText(/haven.t completed/i)).not.toBeInTheDocument()
  })
})

describe('AdminOverviewPage', () => {
  it('renders every metric with its definition, keeping attempts and unique participants separate', async () => {
    vi.mocked(adminApi.fetchAdminStats).mockResolvedValue({
      registered_users: 12, published_challenges: 4, challenges_in_preparation: 2,
      completed_attempts: 30, unique_participants: 9, open_reports: 1,
    })
    renderWithProviders(withAuth(<AdminOverviewPage />, { isAdmin: true }))
    expect(await screen.findByText('30')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('Completed attempts')).toBeInTheDocument()
    expect(screen.getByText('Unique participants')).toBeInTheDocument()
    expect(screen.getByText(/counting repeat attempts/i)).toBeInTheDocument()
    expect(screen.getByText(/distinct people/i)).toBeInTheDocument()
  })

  it('reports a failure plainly', async () => {
    vi.mocked(adminApi.fetchAdminStats).mockRejectedValue(new Error('denied'))
    renderWithProviders(withAuth(<AdminOverviewPage />, { isAdmin: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load the overview/i)
  })
})

describe('SetupRequiredPage', () => {
  it('lists what is wrong with the configuration', () => {
    renderWithProviders(<SetupRequiredPage problems={['VITE_SUPABASE_URL is not set.']} />)
    expect(screen.getByText('VITE_SUPABASE_URL is not set.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/isn.t configured/i)
  })
})
