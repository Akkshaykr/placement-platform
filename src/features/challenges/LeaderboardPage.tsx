import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { leaderboard } from '@/features/assessment/api'
import { toAppError } from '@/features/assessment/errors'
import { formatDateTime, formatMarks } from './labels'
import { cn } from '@/lib/cn'

const LIVE_REFRESH_MS = 10_000

export function LeaderboardPage() {
  const { challengeId = '' } = useParams()
  const query = useQuery({
    queryKey: ['leaderboard', challengeId],
    queryFn: () => leaderboard(challengeId),
    retry: 1,
    // Live while the challenge runs; stop polling once it is final.
    refetchInterval: (q) => (q.state.data?.final ? false : LIVE_REFRESH_MS),
    refetchIntervalInBackground: false,
  })

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading leaderboard" className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (query.isError) {
    return (
      <Alert tone="danger" title="Leaderboard unavailable">
        {toAppError(query.error).message}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>
          Try again
        </button>
      </Alert>
    )
  }

  const b = query.data
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Leaderboard</h1>
          <p className="mt-1 text-ink-muted">{b.challenge.title}</p>
        </div>
        <div className="flex items-center gap-2">
          {b.final ? <Badge>Final</Badge> : <Badge tone="success">Live</Badge>}
          <span className="text-sm text-ink-muted">{b.total_ranked} ranked</span>
        </div>
      </div>

      <p className="text-sm text-ink-muted">
        Each person is ranked by their best finished attempt. Ties go to whoever submitted first. Only finished attempts count.
        {b.my_rank ? ` You are ranked ${b.my_rank}.` : ''}
      </p>

      {b.entries.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">No finished attempts yet</p>
          <p className="mt-2 text-sm text-ink-muted">Scores appear here as participants submit.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Rank</th>
                <th scope="col" className="px-4 py-3 font-medium">Student</th>
                <th scope="col" className="px-4 py-3 font-medium">Score</th>
                <th scope="col" className="px-4 py-3 font-medium">Correct</th>
                <th scope="col" className="px-4 py-3 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {b.entries.map((e) => (
                <tr key={e.rank} className={cn('border-t border-line', e.is_me && 'bg-brand/10')}>
                  <td className="px-4 py-3 font-semibold tabular-nums">{e.rank}</td>
                  <td className="px-4 py-3">
                    {e.display_name}
                    {e.is_me ? <span className="ml-2 text-xs text-brand-soft">(you)</span> : null}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatMarks(e.score)} / {formatMarks(e.max_score)}</td>
                  <td className="px-4 py-3 tabular-nums">{e.correct_count}</td>
                  <td className="px-4 py-3">{formatDateTime(e.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
