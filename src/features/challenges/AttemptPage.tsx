import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { ConfirmAction } from '@/components/ConfirmAction'
import { AnswerSync, type SyncState } from '@/features/assessment/answerSync'
import { navStatus, step, tally, type NavStatus } from '@/features/assessment/attemptLogic'
import { getAttempt, saveAnswer, submitAttempt } from '@/features/assessment/api'
import { toAppError } from '@/features/assessment/errors'
import type { AttemptState } from '@/features/assessment/schemas'
import { createServerClock, formatClock, remainingMs, urgency, type ServerClock } from '@/features/assessment/timer'
import { cn } from '@/lib/cn'

interface Loaded {
  state: AttemptState
  clock: ServerClock
}

export function AttemptPage() {
  const { attemptId = '' } = useParams()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: async (): Promise<Loaded> => {
      const received = Date.now()
      const state = await getAttempt(attemptId)
      return { state, clock: createServerClock(state.server_now, received) }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading attempt" className="space-y-4">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-72" />
      </div>
    )
  }
  if (query.isError) {
    const err = toAppError(query.error)
    if (err.code === 'NOT_FOUND') return <Navigate to="/challenges" replace />
    return (
      <Alert tone="danger" title="Couldn’t load your attempt">
        {err.message}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>
          Try again
        </button>
      </Alert>
    )
  }
  if (query.data.state.status === 'SUBMITTED') {
    return <Navigate to={`/results/${attemptId}`} replace />
  }
  return (
    <AttemptSession
      key={query.data.state.attempt_id}
      state={query.data.state}
      clock={query.data.clock}
      onFinished={() => qc.invalidateQueries({ queryKey: ['attempt', attemptId] })}
    />
  )
}

interface SessionProps {
  state: AttemptState
  clock: ServerClock
  onFinished: () => void
}

/** The live assessment. Its state is initialised from the server snapshot, so a refresh restores it exactly. */
function AttemptSession({ state, clock, onFinished }: SessionProps) {
  const navigate = useNavigate()
  const attemptId = state.attempt_id
  const total = state.questions.length

  const [answers, setAnswers] = useState<Record<string, { optionId: string | null; marked: boolean }>>(() =>
    Object.fromEntries(state.answers.map((a) => [a.question_version_id, { optionId: a.selected_option_id, marked: a.marked_for_review }])),
  )
  const [index, setIndex] = useState(0)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [fatal, setFatal] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [remaining, setRemaining] = useState(() => remainingMs(state.deadline_at, clock))
  const finishingRef = useRef(false)

  const sync = useMemo(
    () => new AnswerSync(saveAnswer, { onFatal: (e) => setFatal(e.message) }),
    [],
  )
  useEffect(() => sync.subscribe(setSyncState), [sync])

  useEffect(() => {
    const id = window.setInterval(() => setRemaining(remainingMs(state.deadline_at, clock)), 500)
    return () => window.clearInterval(id)
  }, [state.deadline_at, clock])

  const finish = useCallback(
    async (expired: boolean) => {
      if (finishingRef.current) return
      finishingRef.current = true
      setFinishing(true)
      setFatal(null)
      try {
        await sync.flush()
      } catch {
        if (!expired) {
          // Submitting now would lose the answers that have not reached the server. Keep the student here.
          finishingRef.current = false
          setFinishing(false)
          setFatal('Some answers are not saved yet. Check your connection; the page will keep trying. Then submit again.')
          return
        }
        // Time is up: the server submits whatever it has, at the deadline. Continue below.
      }
      try {
        await submitAttempt(attemptId)
        onFinished()
        navigate(`/results/${attemptId}`, { replace: true })
      } catch (error) {
        finishingRef.current = false
        setFinishing(false)
        setFatal(toAppError(error).message)
      }
    },
    [attemptId, navigate, onFinished, sync],
  )

  // The countdown is a display of the server deadline. When it reaches zero the attempt is submitted.
  useEffect(() => {
    if (remaining <= 0 && !finishingRef.current) void finish(true)
  }, [remaining, finish])

  // A closed attempt on the server (time ran out elsewhere, or it was completed) ends this screen.
  useEffect(() => {
    if (syncState === 'closed') {
      onFinished()
      navigate(`/results/${attemptId}`, { replace: true })
    }
  }, [syncState, attemptId, navigate, onFinished])

  // Warn before leaving while answers are still unsaved.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (sync.unsentCount > 0 && !finishingRef.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [sync])

  const question = state.questions[index]
  const current = question ? answers[question.question_version_id] : undefined
  const selected = current?.optionId ?? null
  const marked = current?.marked ?? false

  const choose = (questionVersionId: string, optionId: string | null) => {
    const prev = answers[questionVersionId]
    setAnswers((a) => ({ ...a, [questionVersionId]: { optionId, marked: prev?.marked ?? false } }))
    sync.enqueue({ attemptId, questionVersionId, optionId, marked: prev?.marked ?? false })
  }
  const toggleMark = (questionVersionId: string) => {
    const prev = answers[questionVersionId]
    const nextMarked = !(prev?.marked ?? false)
    setAnswers((a) => ({ ...a, [questionVersionId]: { optionId: prev?.optionId ?? null, marked: nextMarked } }))
    sync.enqueue({ attemptId, questionVersionId, optionId: prev?.optionId ?? null, marked: nextMarked })
  }

  const summary = tally(
    state.questions.map((q) => ({ selected: answers[q.question_version_id]?.optionId ?? null, marked: answers[q.question_version_id]?.marked ?? false })),
    total,
  )
  const band = urgency(remaining)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-line bg-surface px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-ink-muted">{state.challenge_title}</p>
          <p className="text-sm">
            Question {index + 1} of {total} · {summary.answered} answered · {summary.unanswered} left
          </p>
        </div>
        <div className="flex items-center gap-4">
          <SaveStatus state={syncState} />
          <div
            role="timer"
            aria-label="Time remaining"
            className={cn(
              'rounded-control border px-4 py-2 font-mono text-xl tabular-nums',
              band === 'danger' && 'border-danger bg-danger/15 text-danger-soft',
              band === 'warning' && 'border-warning bg-warning/15 text-warning',
              band === 'normal' && 'border-line-strong',
            )}
          >
            {formatClock(remaining)}
          </div>
        </div>
      </header>

      {fatal ? (
        <Alert tone="danger" title="Action needed">
          {fatal}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <Card className="space-y-6 p-6">
          {question ? (
            <>
              <div className="space-y-2">
                <p className="text-sm text-ink-muted">Question {index + 1}{question.subtopic ? ` · ${question.subtopic}` : ''}</p>
                <h2 className="whitespace-pre-line text-lg font-medium leading-relaxed">{question.stem}</h2>
              </div>
              <fieldset className="space-y-3">
                <legend className="sr-only">Choose one answer</legend>
                {question.options.map((opt, i) => {
                  const id = `opt-${question.question_version_id}-${opt.id}`
                  return (
                    <label
                      key={opt.id}
                      htmlFor={id}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-control border px-4 py-3 transition-colors',
                        'focus-within:ring-2 focus-within:ring-brand-soft',
                        selected === opt.id ? 'border-brand bg-brand/10' : 'border-line-strong hover:border-brand-soft',
                      )}
                    >
                      <input
                        id={id}
                        type="radio"
                        name={`q-${question.question_version_id}`}
                        className="mt-1 size-4 accent-brand"
                        checked={selected === opt.id}
                        onChange={() => choose(question.question_version_id, opt.id)}
                      />
                      <span>
                        <span className="mr-2 font-medium text-ink-muted">{String.fromCharCode(65 + i)}.</span>
                        {opt.body}
                      </span>
                    </label>
                  )
                })}
              </fieldset>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-brand" checked={marked} onChange={() => toggleMark(question.question_version_id)} />
                  Mark for review
                </label>
                <button
                  type="button"
                  className="text-sm text-ink-muted underline hover:text-ink"
                  onClick={() => choose(question.question_version_id, null)}
                  disabled={selected === null}
                >
                  Clear answer
                </button>
              </div>
            </>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <Button variant="secondary" onClick={() => setIndex((i) => step(i, -1, total))} disabled={index === 0}>
              Previous
            </Button>
            <Button variant="secondary" onClick={() => setIndex((i) => step(i, 1, total))} disabled={index >= total - 1}>
              Next
            </Button>
          </div>
        </Card>

        <aside aria-label="Question navigator" className="space-y-4">
          <Card className="space-y-4 p-4">
            <p className="text-sm font-medium">Questions</p>
            <ol className="grid grid-cols-5 gap-2 lg:grid-cols-4">
              {state.questions.map((q, i) => {
                const a = answers[q.question_version_id]
                const status = navStatus({ isCurrent: i === index, answered: (a?.optionId ?? null) !== null, marked: a?.marked ?? false })
                return (
                  <li key={q.question_version_id}>
                    <button
                      type="button"
                      onClick={() => setIndex(i)}
                      aria-label={`Question ${i + 1}, ${STATUS_TEXT[status]}`}
                      aria-current={i === index ? 'step' : undefined}
                      className={cn('h-10 w-full rounded-control border text-sm font-medium', NAV_CLASS[status])}
                    >
                      {i + 1}
                    </button>
                  </li>
                )
              })}
            </ol>
            <ul className="space-y-1 text-xs text-ink-muted">
              <li>Answered: {summary.answered}</li>
              <li>Unanswered: {summary.unanswered}</li>
              <li>Marked for review: {summary.marked}</li>
            </ul>
          </Card>

          <Card className="space-y-3 p-4">
            <p className="text-sm">
              Submit when you have finished. You cannot change answers afterwards.
            </p>
            <ConfirmAction
              label="Submit attempt"
              question={summary.unanswered > 0 ? `${summary.unanswered} question(s) are unanswered. Submit anyway?` : 'Submit your answers now?'}
              confirmLabel="Yes, submit"
              variant="primary"
              disabled={finishing}
              loading={finishing}
              onConfirm={() => finish(false)}
            />
          </Card>
        </aside>
      </div>
    </div>
  )
}

const STATUS_TEXT: Record<NavStatus, string> = {
  current: 'current',
  marked: 'marked for review',
  answered: 'answered',
  unanswered: 'not answered',
}

const NAV_CLASS: Record<NavStatus, string> = {
  current: 'border-brand bg-brand text-ink',
  marked: 'border-warning bg-warning/20 text-ink',
  answered: 'border-success/60 bg-success/15 text-ink',
  unanswered: 'border-line-strong text-ink-muted hover:border-brand-soft',
}

function SaveStatus({ state }: { state: SyncState }) {
  const text: Record<SyncState, string> = {
    idle: 'Answers save automatically',
    saving: 'Saving…',
    saved: 'All answers saved',
    retrying: 'Connection problem. Retrying…',
    offline: 'Not saved yet. Check your connection.',
    closed: 'Attempt closed',
  }
  return (
    <span role="status" aria-live="polite" className="text-xs text-ink-muted">
      {text[state]}
    </span>
  )
}
