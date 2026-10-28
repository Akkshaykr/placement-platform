import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatCard } from '@/components/StatCard'
import { toAppError } from '@/features/assessment/errors'
import { formatDateTime, formatMarks, formatPercent } from '@/features/challenges/labels'
import { challengeAnalytics, challengeParticipants, getAdminChallenge } from './api'

export function AdminChallengeInsightsPage() {
  const { id = '' } = useParams()
  const detail = useQuery({ queryKey: ['admin', 'challenge', id], queryFn: () => getAdminChallenge(id), retry: 1 })
  const analytics = useQuery({ queryKey: ['admin', 'analytics', id], queryFn: () => challengeAnalytics(id), enabled: !!id, retry: 1 })
  const participants = useQuery({ queryKey: ['admin', 'participants', id], queryFn: () => challengeParticipants(id), enabled: !!id, retry: 1 })

  if (detail.isError && toAppError(detail.error).code === 'NOT_FOUND') return <Navigate to="/admin/challenges" replace />
  if (detail.isPending) return <Skeleton className="h-96" />

  const a = analytics.data
  const title = detail.data?.challenge.title ?? ''

  return (
    <div className="space-y-8">
      <div>
        <Link to={`/admin/challenges/${id}`} className="text-sm text-brand-soft underline">← Back to challenge</Link>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{title}</h1>
        <p className="mt-2 text-ink-muted">Figures are calculated from stored attempts. Each one states its definition.</p>
      </div>

      {analytics.isError ? <Alert tone="danger" title="Analytics unavailable">{toAppError(analytics.error).message}</Alert> : null}

      <section aria-labelledby="kpi-h" className="space-y-3">
        <h2 id="kpi-h" className="text-lg font-semibold">Participation</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Registered" value={a?.registered} loading={analytics.isPending} error={analytics.isError} definition="People who joined the challenge." />
          <StatCard label="Started (people)" value={a?.started_users} loading={analytics.isPending} error={analytics.isError} definition="Distinct people with at least one attempt." />
          <StatCard label="Completed attempts" value={a?.completed_attempts} loading={analytics.isPending} error={analytics.isError} definition="Attempts finalised by a student or the server (time out or completion)." />
          <StatCard label="Average score" value={a?.average_score ?? undefined} loading={analytics.isPending} error={analytics.isError} definition={a ? `Mean of finalised scores (out of ${formatMarks(a.max_score)}).` : 'Mean of finalised scores.'} />
        </div>
        {a ? (
          <p className="text-sm text-ink-muted">
            Participation rate: {formatPercent(a.participation_rate === null ? null : a.participation_rate * 100)} (people who started ÷ registered).
            Completion rate: {formatPercent(a.completion_rate === null ? null : a.completion_rate * 100)} (completed attempts ÷ started attempts).
            Average percentage: {formatPercent(a.average_percentage)}.
          </p>
        ) : null}
      </section>

      {a ? (
        <section aria-labelledby="dist-h" className="space-y-3">
          <h2 id="dist-h" className="text-lg font-semibold">Score distribution</h2>
          <p className="text-sm text-ink-muted">Finalised attempts grouped by percentage. Definition: each attempt's score ÷ maximum score, grouped in bands of 20 points.</p>
          <div className="grid grid-cols-5 gap-2">
            {a.score_distribution.map((b) => (
              <Card key={b.band} className="p-3 text-center">
                <p className="text-xs text-ink-muted">{b.band}%</p>
                <p className="text-2xl font-semibold tabular-nums">{b.count}</p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {a && a.questions.length > 0 ? (
        <section aria-labelledby="q-h" className="space-y-3">
          <h2 id="q-h" className="text-lg font-semibold">Question performance</h2>
          <p className="text-sm text-ink-muted">
            Correct rate: correct answers ÷ finalised attempts that included the question. Flags need at least 10 attempts.
            <strong className="font-medium text-ink"> Too easy</strong> means 90% or more correct. <strong className="font-medium text-ink">Too difficult</strong> means 20% or less.
            <strong className="font-medium text-ink"> Possibly ambiguous</strong> needs at least 20 attempts and means students who scored higher were not more likely to answer correctly than students who scored lower.
            These are prompts to review, not verdicts.
          </p>
          <div className="overflow-x-auto rounded-panel border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">#</th>
                  <th scope="col" className="px-4 py-3 font-medium">Question</th>
                  <th scope="col" className="px-4 py-3 font-medium">Correct</th>
                  <th scope="col" className="px-4 py-3 font-medium">Attempts</th>
                  <th scope="col" className="px-4 py-3 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody>
                {a.questions.map((q) => (
                  <tr key={q.question_version_id} className="border-t border-line">
                    <td className="px-4 py-3 tabular-nums">{q.position}</td>
                    <td className="px-4 py-3">{q.stem}</td>
                    <td className="px-4 py-3 tabular-nums">{formatPercent(q.correct_rate === null ? null : q.correct_rate * 100)}</td>
                    <td className="px-4 py-3 tabular-nums">{q.seen}</td>
                    <td className="px-4 py-3">{q.flag ? <Badge tone="warning">{FLAG_TEXT[q.flag]}</Badge> : <span className="text-ink-muted">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {a && a.topics.length > 0 ? (
        <section aria-labelledby="t-h" className="space-y-3">
          <h2 id="t-h" className="text-lg font-semibold">Topic performance</h2>
          <p className="text-sm text-ink-muted">Correct answers ÷ answers given to questions in the topic, across all finalised attempts.</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {a.topics.map((t) => (
              <li key={t.topic_name}>
                <Card className="p-4">
                  <p className="font-medium">{t.topic_name}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPercent(t.accuracy === null ? null : t.accuracy * 100)}</p>
                  <p className="text-xs text-ink-muted">{t.correct} of {t.answers} answers correct</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="p-h" className="space-y-3">
        <h2 id="p-h" className="text-lg font-semibold">Registered participants</h2>
        {participants.isError ? <Alert tone="danger">{toAppError(participants.error).message}</Alert> : null}
        {participants.isPending ? <Skeleton className="h-40" /> : (participants.data ?? []).length === 0 ? (
          <Card className="p-6 text-sm text-ink-muted">Nobody has joined yet.</Card>
        ) : (
          <div className="overflow-x-auto rounded-panel border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Name</th>
                  <th scope="col" className="px-4 py-3 font-medium">Joined</th>
                  <th scope="col" className="px-4 py-3 font-medium">Attempts</th>
                  <th scope="col" className="px-4 py-3 font-medium">Completed</th>
                  <th scope="col" className="px-4 py-3 font-medium">Best score</th>
                </tr>
              </thead>
              <tbody>
                {(participants.data ?? []).map((p) => (
                  <tr key={p.user_id} className="border-t border-line">
                    <td className="px-4 py-3">{p.display_name}</td>
                    <td className="px-4 py-3">{formatDateTime(p.registered_at)}</td>
                    <td className="px-4 py-3 tabular-nums">{p.attempts}</td>
                    <td className="px-4 py-3 tabular-nums">{p.completed_attempts}</td>
                    <td className="px-4 py-3 tabular-nums">{p.best_score === null ? '-' : formatMarks(p.best_score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

const FLAG_TEXT = { TOO_EASY: 'Too easy', TOO_DIFFICULT: 'Too difficult', POSSIBLY_AMBIGUOUS: 'Possibly ambiguous' } as const
