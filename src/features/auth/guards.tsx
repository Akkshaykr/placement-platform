import { Navigate, Outlet, useLocation } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { PageLoading } from '@/components/PageLoading'
import { ForbiddenPage } from '@/pages/ForbiddenPage'
import { safeNextPath } from '@/lib/safeRedirect'
import { useAuth } from './useAuth'

/**
 * Route guards are a usability layer. They keep people out of screens that would be empty or
 * broken for them. They are NOT the security boundary: every protected read and write is also
 * checked by the database (grants + row level security), so bypassing these guards gains nothing.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <PageLoading />
  if (status === 'unauthenticated') {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <Outlet />
}

export function RequireAdmin() {
  const { rolesStatus, isAdmin, retryRoles } = useAuth()
  if (rolesStatus === 'idle' || rolesStatus === 'loading') return <PageLoading />
  if (rolesStatus === 'error') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Alert tone="danger" title="We couldn’t check your permissions">
          Try again in a moment.
        </Alert>
        <Button className="mt-4" variant="secondary" onClick={retryRoles}>
          Retry
        </Button>
      </div>
    )
  }
  if (!isAdmin) return <ForbiddenPage />
  return <Outlet />
}

/** Keeps signed-in people out of the sign-in and registration screens. */
export function RedirectIfAuthenticated({ allowRecovery = false }: { allowRecovery?: boolean }) {
  const { status, recovering } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <PageLoading />
  if (status === 'authenticated' && !(allowRecovery && recovering)) {
    const next = new URLSearchParams(location.search).get('next')
    return <Navigate to={safeNextPath(next)} replace />
  }
  return <Outlet />
}
