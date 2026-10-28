import { NavLink, Outlet, useNavigate } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Brand } from '@/components/ui/Brand'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/features/auth/useAuth'
import { cn } from '@/lib/cn'

export interface NavItem {
  to: string
  label: string
  end?: boolean
}

interface AppShellProps {
  nav: NavItem[]
  variant: 'student' | 'admin'
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-control px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink',
  )

/** Header + navigation shared by the student and administrator areas. */
export function AppShell({ nav, variant }: AppShellProps) {
  const { profile, user, isAdmin, signOut } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const name = profile?.display_name ?? user?.email ?? 'Account'

  const handleSignOut = async () => {
    // Navigate first: once the session clears, the route guard would redirect to /login and
    // unmount this header before a navigation placed after signOut() could run.
    navigate('/', { replace: true })
    try {
      await signOut()
    } catch {
      toast.error('Couldn’t sign you out. Try again.')
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-line bg-surface">
        <div className={cn('h-0.5', variant === 'admin' ? 'bg-danger' : 'bg-brand')} aria-hidden="true" />
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Brand to={variant === 'admin' ? '/admin' : '/dashboard'} />
            {variant === 'admin' ? <Badge tone="danger">Administrator</Badge> : null}
          </div>
          <nav aria-label="Main" className="order-3 -mx-2 flex w-full gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto sm:flex-1">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-40 truncate text-sm text-ink-muted sm:inline" title={name}>
              {name}
            </span>
            {variant === 'student' && isAdmin ? (
              <NavLink to="/admin" className={linkClass}>
                Admin
              </NavLink>
            ) : null}
            <Button variant="ghost" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}
