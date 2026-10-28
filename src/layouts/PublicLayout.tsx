import { Link, Outlet } from 'react-router'
import { Brand } from '@/components/ui/Brand'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { cn } from '@/lib/cn'
import { useAuth } from '@/features/auth/useAuth'
import { APP_NAME } from '@/lib/brand'

export function PublicLayout() {
  const { status } = useAuth()
  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        <Brand />
        <nav aria-label="Account" className="flex items-center gap-2">
          {status === 'authenticated' ? (
            <Link to="/dashboard" className={buttonStyles('secondary')}>
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className={buttonStyles('ghost')}>
                Sign in
              </Link>
              <Link to="/register" className={cn(buttonStyles('primary'), 'hidden sm:inline-flex')}>
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-6 text-sm text-ink-muted">© {new Date().getFullYear()} {APP_NAME}</p>
      </footer>
    </div>
  )
}
