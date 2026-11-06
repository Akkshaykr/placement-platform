import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { challengeDetail, registerForChallenge, startAttempt } from '@/features/assessment/api'
import { toAppError } from '@/features/assessment/errors'
import { DIFFICULTY_LABEL, RELEASE_LABEL, STATE_LABEL, STATE_TONE, formatDateTime, formatMarks, formatPercent, formatWindow } from './labels'

export function ChallengeDetailPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [language, setLanguage] = useState<'en' | 'ta'>('en')
  const query = useQuery({ queryKey: ['challenge', slug], queryFn: () => challengeDetail(slug), retry: false })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['challenge', slug] })
    qc.invalidateQueries({ queryKey: ['challenges', 'student'] })
  }

  const register = useMutation({ mutationFn: (id: string) => registerForChallenge(id), onSuccess: refresh })
  const start = useMutation({
    mutationFn: (id: string) => startAttempt(id, language),
    onSuccess: (attempt) => navigate(`/attempt/${attempt.attempt_id}`),
    onError: refresh,
  })

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading challenge" className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (query.isError) {
    const err = toAppError(query.error)
    if (err.code === 'NOT_FOUND') return <Navigate to="/challenges" replace />
    return (
      <Alert tone="danger" title="Couldn’t load this challenge">
        {err.message}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>
          Try again
        </button>
      </Alert>
    )
  }

  const c = query.data
  const startError = start.error ? toAppError(start.error) : null
  const registerError = register.error ? toAppError(register.error) : null
  const attemptsUsed = c.max_attempts !== null && c.my_attempts >= c.max_attempts
  const canJoin = (c.state === 'OPEN' || c.state === 'UPCOMING') && !c.is_registered && !c.is_full
  const canStart = c.state === 'OPEN' && (c.is_registered || !c.is_full) && !attemptsUsed
  const canResume = c.running_attempt_id !== null
  const canSeeBoard = c.is_registered || c.state === 'COMPLETED'

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</Badge>
          <Badge>{DIFFICULTY_LABEL[c.difficulty]}</Badge>
          {c.topic_name ? <span className="text-sm text-ink-muted">{c.topic_name}</span> : null}
        </div>
        <h1 className="text-2xl font-semibold sm:text-3xl">{c.title}</h1>
        {c.description ? <p className="max-w-3xl text-ink-muted">{c.description}</p> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-4 p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold">Before you start</h2>
          {c.instructions ? <p className="whitespace-pre-line text-sm text-ink-muted">{c.instructions}</p> : null}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Fact label="Questions" value={String(c.question_count)} />
            <Fact label="Time limit" value={`${c.time_limit_minutes} minutes`} />
            <Fact label="Marks per correct" value={formatMarks(c.points_per_correct)} />
            <Fact label="Negative marking" value={c.negative_marking_enabled ? `−${formatMarks(c.penalty_per_incorrect)} per wrong` : 'None'} />
            <Fact label="Attempts allowed" value={c.max_attempts === null ? 'Unlimited' : String(c.max_attempts)} />
            <Fact label="Your attempts" value={String(c.my_attempts)} />
            <Fact label="Question order" value={c.shuffle_questions ? 'Shuffled per attempt' : 'Fixed'} />
            <Fact label="Option order" value={c.shuffle_options ? 'Shuffled per attempt' : 'Fixed'} />
            <Fact label="Results" value={RELEASE_LABEL[c.result_release]} />
          </dl>
          <p className="text-sm text-ink-muted">
            The window is {formatWindow(c.start_at, c.end_at)}. Your time starts when you begin. If the window closes first, your attempt ends at the close time.
          </p>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">Your part</h2>
          {c.state === 'OPEN' && c.end_at ? <p className="text-sm text-ink-muted">Closes {formatDateTime(c.end_at)}.</p> : null}
          {c.state === 'UPCOMING' && c.start_at ? <p className="text-sm text-ink-muted">Opens {formatDateTime(c.start_at)}.</p> : null}
          {c.state === 'CANCELLED' ? <p className="text-sm text-danger-soft">This challenge was cancelled.</p> : null}
          {c.is_full && !c.is_registered ? <p className="text-sm text-warning">This challenge has reached its participant limit.</p> : null}
          {attemptsUsed ? <p className="text-sm text-ink-muted">You have used all your attempts for this challenge.</p> : null}

          {canStart && !canResume && c.languages.includes('ta') && c.tamil_ready ? (
            <div role="group" aria-label="Language" className="space-y-2">
              <p className="text-sm text-ink-muted">Choose your language</p>
              <div className="flex gap-2">
                <Button type="button" variant={language === 'en' ? 'primary' : 'secondary'} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>
                  English
                </Button>
                <Button type="button" variant={language === 'ta' ? 'primary' : 'secondary'} aria-pressed={language === 'ta'} onClick={() => setLanguage('ta')}>
                  தமிழ்
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-3">
            {canResume ? (
              <Button size="lg" onClick={() => navigate(`/attempt/${c.running_attempt_id}`)}>
                Resume attempt
              </Button>
            ) : canStart ? (
              <Button size="lg" loading={start.isPending} onClick={() => start.mutate(c.id)}>
                {c.is_registered ? 'Start attempt' : 'Join and start'}
              </Button>
            ) : canJoin ? (
              <Button size="lg" variant="secondary" loading={register.isPending} onClick={() => register.mutate(c.id)}>
                Join challenge
              </Button>
            ) : null}
            {canSeeBoard ? (
              <Link to={`/leaderboard/${c.id}`} className="inline-flex h-12 items-center justify-center rounded-control border border-line-strong px-6 text-sm font-medium text-ink hover:border-brand-soft">
                Leaderboard
              </Link>
            ) : null}
          </div>

          {startError ? <Alert tone="danger" title="Can’t start yet">{startError.message}</Alert> : null}
          {registerError ? <Alert tone="danger" title="Couldn’t join">{registerError.message}</Alert> : null}
        </Card>
      </div>

      {c.attempts && c.attempts.length > 0 ? (
        <section aria-labelledby="my-attempts" className="space-y-3">
          <h2 id="my-attempts" className="text-lg font-semibold">Your submitted attempts</h2>
          <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
            {c.attempts.map((a) => (
              <li key={a.attempt_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  Attempt {a.attempt_number ?? ''} · {a.score} / {a.max_score} ({formatPercent(a.percentage)})
                </span>
                <Link className="text-brand-soft underline" to={`/results/${a.attempt_id}`}>
                  View result
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
