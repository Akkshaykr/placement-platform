import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { Spinner } from '@/components/ui/Spinner'
import { readCallbackError } from './callbackError'
import { consumeNextPath } from './nextPath'
import { useAuth } from './useAuth'

const TIMEOUT_MS = 10_000

export function AuthCallbackPage() {
  const { status } = useAuth()
  const [timedOut, setTimedOut] = useState(false)
  const error = readCallbackError(window.location.search, window.location.hash)

  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [])

  if (status === 'authenticated') return <Navigate to={consumeNextPath()} replace />

  if (error || (timedOut && status === 'unauthenticated')) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <Alert tone="danger" title="We couldn’t finish signing you in">
          {error ?? 'The link may have expired or already been used.'}
        </Alert>
        <Link to="/login" className={`${buttonStyles('primary')} mt-6`}>
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div role="status" className="flex min-h-svh items-center justify-center gap-3 text-ink-muted">
      <Spinner />
      <span>Signing you in…</span>
    </div>
  )
}
