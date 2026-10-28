import { useQuery } from '@tanstack/react-query'
import { Alert } from '@/components/ui/Alert'
import { StatCard } from '@/components/StatCard'
import { fetchAdminStats, type AdminStats } from './api'

interface Metric {
  key: keyof AdminStats
  label: string
  definition: string
}

const METRICS: Metric[] = [
  { key: 'registered_users', label: 'Registered users', definition: 'Accounts with a profile record.' },
  { key: 'published_challenges', label: 'Published challenges', definition: 'Challenges with status PUBLISHED that are not deleted.' },
  { key: 'challenges_in_preparation', label: 'Challenges in preparation', definition: 'Drafts and challenges being generated, reviewed, validated or rejected.' },
  { key: 'completed_attempts', label: 'Completed attempts', definition: 'Every submitted attempt, counting repeat attempts by the same person.' },
  { key: 'unique_participants', label: 'Unique participants', definition: 'Distinct people with at least one submitted attempt.' },
  { key: 'open_reports', label: 'Open reports', definition: 'Question error reports and feedback not yet resolved or dismissed.' },
]

export function AdminOverviewPage() {
  const stats = useQuery({ queryKey: ['admin', 'overview'], queryFn: fetchAdminStats })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Overview</h1>
        <p className="mt-2 text-ink-muted">Live counts from the database. Each figure states how it is calculated.</p>
      </div>
      {stats.isError ? (
        <Alert tone="danger" title="Couldn’t load the overview">
          Check your connection and reload the page.
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {METRICS.map((m) => (
          <StatCard key={m.key} label={m.label} value={stats.data?.[m.key]} loading={stats.isPending} error={stats.isError} definition={m.definition} />
        ))}
      </div>
    </div>
  )
}
