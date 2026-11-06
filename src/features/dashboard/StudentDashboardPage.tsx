import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { StatCard } from '@/components/StatCard'
import { Reveal } from '@/components/fx/Reveal'
import { useAuth } from '@/features/auth/useAuth'
import { countCompletedAttempts, countOpenChallenges } from './api'

export function StudentDashboardPage() {
  const { profile, user } = useAuth()
  const open = useQuery({ queryKey: ['dashboard', 'open-challenges'], queryFn: countOpenChallenges })
  const completed = useQuery({ queryKey: ['dashboard', 'completed-attempts', user?.id], queryFn: countCompletedAttempts })

  return (
    <div className="space-y-8">
      <Reveal>
        <h1 className="text-2xl font-semibold sm:text-3xl">Welcome{profile ? `, ${profile.display_name}` : ''}</h1>
        <p className="mt-2 text-ink-muted">Your practice at a glance.</p>
      </Reveal>

      <Reveal delayMs={80} className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Open challenges"
          value={open.data}
          loading={open.isPending}
          error={open.isError}
          definition="Challenges that are published, not deleted, and inside their start and end time right now."
        />
        <StatCard
          label="Attempts completed"
          value={completed.data}
          loading={completed.isPending}
          error={completed.isError}
          definition="Your own attempts that were submitted, or ended automatically when time ran out."
        />
      </Reveal>

      {completed.data === 0 ? (
        <Reveal delayMs={160}>
          <Card className="p-6" interactive>
            <h2 className="font-medium">You haven’t completed an attempt yet</h2>
            <p className="mt-2 text-sm text-ink-muted">Your scores, accuracy and history will appear here after your first attempt.</p>
          </Card>
        </Reveal>
      ) : null}
    </div>
  )
}
