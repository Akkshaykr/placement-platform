import { Outlet } from 'react-router'
import { Brand } from '@/components/ui/Brand'
import { AnimatedBackground } from '@/components/fx/AnimatedBackground'
import { SpotlightLayer } from '@/components/fx/SpotlightLayer'
import { APP_NAME } from '@/lib/brand'

export function AuthLayout() {
  return (
    <div className="relative isolate grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <AnimatedBackground />
      <aside className="hidden flex-col justify-between border-r border-line bg-surface p-10 lg:flex">
        <Brand />
        <img
          src="/images/kanithamedhai-login-visual.png"
          alt={`${APP_NAME}: timed aptitude practice`}
          className="mx-auto max-h-[70svh] w-auto max-w-full rounded-panel object-contain"
        />
        <p className="text-sm text-ink-muted">Create an account to attempt published challenges.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10">
        <SpotlightLayer className="w-full max-w-sm overflow-hidden rounded-panel">
          <div className="fx-glass rounded-panel p-6">
            <div className="mb-8 lg:hidden">
              <Brand />
            </div>
            <Outlet />
          </div>
        </SpotlightLayer>
      </main>
    </div>
  )
}
