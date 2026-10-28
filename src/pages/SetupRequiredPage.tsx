import { Card } from '@/components/ui/Card'
import { APP_NAME } from '@/lib/brand'

/** Shown instead of the app when the public configuration is missing or unsafe. */
export function SetupRequiredPage({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div className="signal-rule mb-6 w-16" aria-hidden="true" />
      <h1 className="text-2xl font-semibold">{APP_NAME} isn’t configured yet</h1>
      <p className="mt-3 text-ink-muted">The app needs a Supabase project before it can start. Fix the items below, then restart the dev server.</p>
      <Card className="mt-6 p-5">
        <ul className="list-disc space-y-2 pl-5 text-sm">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Card>
      <p className="mt-6 text-sm text-ink-muted">
        Copy <code className="rounded bg-raised px-1.5 py-0.5">.env.example</code> to <code className="rounded bg-raised px-1.5 py-0.5">.env.local</code> and fill in your project’s values. See
        docs/windows-setup.md for step-by-step instructions.
      </p>
    </main>
  )
}
