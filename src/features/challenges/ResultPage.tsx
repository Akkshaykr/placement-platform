import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { getResult } from '@/features/assessment/api'
import { toAppError } from '@/features/assessment/errors'
import { formatDuration, formatMarks, formatPercent, RELEASE_LABEL } from './labels'

export function ResultPage() {
  const { attemptId = '' } = useParams()
  const query = useQuery({ queryKey: ['result', attemptId], queryFn: () => getResult(attemptId), retry: 1 })

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading result" className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (query.isError) {
    const err = toAppError(query.error)
    if (err.code === 'NOT_FOUND') return <Navigate to="/history" replace />
    return (
      <Alert tone="danger" title="Couldn’t load your result">
        {err.message}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>
          Try again
        </button>
      </Alert>
    )
  }

  const r = query.data
  if (r.status !== 'SUBMITTED' || !r.summary) return <Navigate to={`/attempt/${attemptId}`} replace />

  const s = r.summary
  const timedOut = s.submitted_via === 'TIMEOUT'

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm text-ink-muted">{r.challenge?.title}</p>
        <h1 className="text-2xl font-semibold sm:text-3xl">Your result</h1>
        {timedOut ? <p className="text-sm text-ink-muted">Time ran out, so your answers were submitted automatically at the deadline.</p> : null}
      </div>

      <section aria-label="Score" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Score" value={`${formatMarks(s.score)} / ${formatMarks(s.max_score)}`} />
        <Stat label="Percentage" value={formatPercent(s.percentage)} />
        <Stat label="Time taken" value={formatDuration(s.time_taken_seconds)} />
        <Stat label="Correct / wrong / skipped" value={`${s.correct_count} / ${s.incorrect_count} / ${s.unanswered_count}`} />
      </section>

      {r.released === false ? (
        <Alert tone="info" title="Correct answers are not shown yet">
          {r.release_policy ? RELEASE_LABEL[r.release_policy] : 'The administrator controls when answers are shown.'}. Your score above is final.
        </Alert>
      ) : null}

      {r.topics && r.topics.length > 0 ? (
        <section aria-labelledby="topics-h" className="space-y-3">
          <h2 id="topics-h" className="text-lg font-semibold">Topic-wise performance</h2>
          <div className="overflow-x-auto rounded-panel border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Topic</th>
                  <th scope="col" className="px-4 py-3 font-medium">Correct</th>
                  <th scope="col" className="px-4 py-3 font-medium">Wrong</th>
                  <th scope="col" className="px-4 py-3 font-medium">Skipped</th>
                  <th scope="col" className="px-4 py-3 font-medium">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {r.topics.map((t) => (
                  <tr key={t.topic_name} className="border-t border-line">
                    <th scope="row" className="px-4 py-3 text-left font-medium">{t.topic_name}</th>
                    <td className="px-4 py-3">{t.correct} / {t.total}</td>
                    <td className="px-4 py-3">{t.incorrect}</td>
                    <td className="px-4 py-3">{t.unanswered}</td>
                    <td className="px-4 py-3">{formatPercent(t.accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {r.questions && r.questions.length > 0 ? (
        <section aria-labelledby="review-h" className="space-y-4">
          <h2 id="review-h" className="text-lg font-semibold">Question review</h2>
          <ol className="space-y-4">
            {r.questions.map((q) => {
              const chosen = q.options.find((o) => o.id === q.selected_option_id)
              const correct = q.options.find((o) => o.is_correct === true)
              return (
                <li key={q.question_version_id}>
                  <Card className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                      <span>Question {q.position}</span>
                      {q.topic_name ? <span>· {q.topic_name}</span> : null}
                      {q.is_correct === true ? <Badge tone="success">Correct</Badge> : null}
                      {q.is_correct === false ? <Badge tone="danger">Wrong</Badge> : null}
                      {!q.answered ? <Badge>Skipped</Badge> : null}
                    </div>
                    <p className="whitespace-pre-line font-medium">{q.stem}</p>
                    <p className="text-sm">
                      Your answer: {chosen ? chosen.body : 'none'}
                    </p>
                    {r.released && correct ? <p className="text-sm">Correct answer: {correct.body}</p> : null}
                    {r.released && q.explanation ? (
                      <p className="whitespace-pre-line border-l-2 border-brand/60 pl-3 text-sm text-ink-muted">{q.explanation}</p>
                    ) : null}
                  </Card>
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  )
}
