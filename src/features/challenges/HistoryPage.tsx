import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { myAttempts } from '@/features/assessment/api'
import { toAppError } from '@/features/assessment/errors'
import { formatDateTime, formatMarks, formatPercent } from './labels'

export function HistoryPage() {
  const query = useQuery({ queryKey: ['history'], queryFn: myAttempts, retry: 1 })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Your attempts</h1>
        <p className="mt-2 text-ink-muted">Every attempt you have started, newest first.</p>
      </div>

      {query.isPending ? (
        <div role="status" aria-label="Loading history" className="space-y-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : query.isError ? (
        <Alert tone="danger" title="Couldn’t load your history">
          {toAppError(query.error).message}{' '}
          <button type="button" className="underline" onClick={() => query.refetch()}>
            Try again
          </button>
        </Alert>
      ) : query.data.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">No attempts yet</p>
          <Link to="/challenges" className="mt-3 inline-block text-brand-soft underline">
            Browse challenges
          </Link>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Challenge</th>
                <th scope="col" className="px-4 py-3 font-medium">Started</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Score</th>
                <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((a) => (
                <tr key={a.attempt_id} className="border-t border-line">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {a.challenge_title}
                    <span className="block text-xs font-normal text-ink-muted">Attempt {a.attempt_number}</span>
                  </th>
                  <td className="px-4 py-3">{formatDateTime(a.started_at)}</td>
                  <td className="px-4 py-3">{a.status === 'SUBMITTED' ? (a.submitted_via === 'TIMEOUT' ? 'Auto-submitted' : 'Submitted') : 'In progress'}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {a.score === null || a.max_score === null ? '-' : `${formatMarks(a.score)} / ${formatMarks(a.max_score)} (${formatPercent(a.percentage)})`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.status === 'SUBMITTED' ? (
                      <Link className="text-brand-soft underline" to={`/results/${a.attempt_id}`}>Result</Link>
                    ) : (
                      <Link className="text-brand-soft underline" to={`/attempt/${a.attempt_id}`}>Resume</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
