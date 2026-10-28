import { Outlet } from 'react-router'
import { Brand } from '@/components/ui/Brand'
import { APP_NAME } from '@/lib/brand'

export function AuthLayout() {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between border-r border-line bg-surface p-10 lg:flex">
        <Brand />
        <div className="max-w-sm">
          <div className="signal-rule mb-6 w-16" aria-hidden="true" />
          <p className="text-2xl font-semibold leading-snug tracking-tight">Timed aptitude practice, with answers you can trust.</p>
          <p className="mt-4 text-ink-muted">Every challenge on {APP_NAME} is created and published by an administrator, never automatically.</p>
        </div>
        <p className="text-sm text-ink-muted">Create an account to attempt published challenges.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
