import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { toAppError } from '@/features/assessment/errors'
import { MAX_OPTIONS, MIN_OPTIONS, validateQuestionDraft } from '@/features/admin/forms'
import { useTopics } from '@/features/admin/useTopics'
import { TopicOptions } from '@/features/admin/TopicOptions'
import type { Check, QuestionDetail } from '@/features/admin/adminSchemas'
import { approveQuestion, getQuestion, saveQuestion } from './api'
import { cn } from '@/lib/cn'

const CHECK_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { PASS: 'success', WARN: 'warning', FAIL: 'danger', SKIPPED: 'neutral' }
const CHECK_NAME: Record<string, string> = {
  ANSWER_KEY: 'Correct answer is set',
  OPTION_COUNT: 'Number of options',
  OPTIONS_DISTINCT: 'Options are different',
  EXPLANATION: 'Explanation present',
  HUMAN_REVIEW: 'Human review',
  MODEL_SOLVER_AGREEMENT: 'Second-model check',
}

export function QuestionEditorPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams()
  const query = useQuery({ queryKey: ['admin', 'question', id], queryFn: () => getQuestion(id!), enabled: mode === 'edit' && !!id, retry: 1 })

  if (mode === 'create') return <QuestionSession key="new" detail={null} />
  if (query.isPending) return <Skeleton className="h-96" />
  if (query.isError) {
    if (toAppError(query.error).code === 'NOT_FOUND') return <Navigate to="/admin/questions" replace />
    return <Alert tone="danger" title="Couldn’t load this question">{toAppError(query.error).message}</Alert>
  }
  return <QuestionSession key={`${query.data.question_id}-${query.data.question_version_id}`} detail={query.data} />
}

function QuestionSession({ detail }: { detail: QuestionDetail | null }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const topics = useTopics()
  const [stem, setStem] = useState(detail?.stem ?? '')
  const [subtopic, setSubtopic] = useState(detail?.subtopic ?? '')
  const [topicId, setTopicId] = useState(detail?.topic_id ?? '')
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>(detail?.difficulty ?? 'MEDIUM')
  const [seconds, setSeconds] = useState(String(detail?.estimated_seconds ?? 60))
  const [options, setOptions] = useState<string[]>(detail?.options.map((o) => o.body) ?? ['', '', '', ''])
  const [correct, setCorrect] = useState(() => {
    const idx = detail?.options.findIndex((o) => o.id === detail.correct_option_id) ?? -1
    return idx >= 0 ? idx + 1 : 1
  })
  const [explanation, setExplanation] = useState(detail?.explanation ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const locked = detail?.locked ?? false
  const refresh = () => {
    if (detail) qc.invalidateQueries({ queryKey: ['admin', 'question', detail.question_id] })
    qc.invalidateQueries({ queryKey: ['admin', 'questions'] })
  }
  const fail = (e: unknown) => setBanner(toAppError(e).message)

  const save = useMutation({
    mutationFn: async () => {
      const local = validateQuestionDraft({ stem, options, correctPosition: correct, topicId })
      setErrors(local)
      if (Object.keys(local).length > 0) throw new Error('Fix the highlighted fields first.')
      const seconds_ = Number(seconds)
      if (!Number.isInteger(seconds_) || seconds_ < 10 || seconds_ > 1800) throw new Error('Estimated time must be 10 to 1800 seconds.')
      return saveQuestion(detail?.question_id ?? null, {
        stem: stem.trim(),
        subtopic: subtopic.trim(),
        topic_id: topicId,
        difficulty,
        estimated_seconds: seconds_,
        options: options.map((o) => o.trim()),
        correct_position: correct,
        explanation: explanation.trim(),
      })
    },
    onSuccess: (saved) => {
      setBanner(null)
      setConfirmed(false)
      toast.success(detail && !locked ? 'Question saved. It needs approval again.' : locked ? 'A new version was created. The published challenge keeps the old one.' : 'Question saved.')
      if (!detail) navigate(`/admin/questions/${saved.question_id}`, { replace: true })
      else refresh()
    },
    onError: fail,
  })

  const approve = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error('Save the question first.')
      return approveQuestion(detail.question_version_id)
    },
    onSuccess: () => { toast.success('Approved. It can now be added to challenges.'); refresh() },
    onError: fail,
  })

  const onSubmit = (e: FormEvent) => { e.preventDefault(); save.mutate() }
  const blocked = detail?.checks.some((c) => c.outcome === 'FAIL') ?? false
  const hasKey = !!detail?.correct_option_id

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {detail ? <Badge tone={detail.review_status === 'ADMIN_APPROVED' ? 'success' : detail.review_status === 'FAILED' ? 'danger' : 'warning'}>{detail.review_status === 'ADMIN_APPROVED' ? 'Approved' : detail.review_status === 'FAILED' ? 'Failed checks' : 'Needs approval'}</Badge> : <Badge>New</Badge>}
          {detail ? <span className="text-sm text-ink-muted">{detail.origin === 'AI' ? 'AI-generated draft' : 'Written by hand'} · version {detail.version_number} of {detail.version_count}</span> : null}
        </div>
        <h1 className="text-2xl font-semibold sm:text-3xl">{detail ? 'Review question' : 'New question'}</h1>
        {locked ? (
          <Alert tone="info" title="Used by a published challenge">
            Editing creates version {detail!.version_number + 1}. The published version stays exactly as students saw it.
          </Alert>
        ) : null}
        {detail?.origin === 'AI' ? (
          <Alert tone="warning" title="Check this answer yourself">
            AI-generated questions can be wrong. Work the question out, confirm the correct option and explanation, then approve it.
          </Alert>
        ) : null}
      </div>

      {banner ? <Alert tone="danger" title="Not saved">{banner}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={onSubmit} className="lg:col-span-2" aria-label="Question">
          <Card className="space-y-5 p-6">
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Question text</span>
              <textarea className={cn('min-h-28 w-full rounded-control border bg-canvas p-3', errors.stem ? 'border-danger' : 'border-line-strong')} value={stem} onChange={(e) => setStem(e.target.value)} maxLength={4000} aria-invalid={!!errors.stem || undefined} />
              {errors.stem ? <span className="text-xs text-danger-soft">{errors.stem}</span> : null}
            </label>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">Topic</span>
                <select className={cn('h-11 w-full rounded-control border bg-canvas px-3', errors.topicId ? 'border-danger' : 'border-line-strong')} value={topicId} onChange={(e) => setTopicId(e.target.value)} aria-invalid={!!errors.topicId || undefined}>
                  <option value="">Choose a topic</option>
                  <TopicOptions topics={topics.data ?? []} />
                </select>
                {errors.topicId ? <span className="text-xs text-danger-soft">{errors.topicId}</span> : null}
              </label>
              <Field label="Subtopic" value={subtopic} onChange={(e) => setSubtopic(e.target.value)} placeholder="e.g. Boats and streams" />
              <label className="space-y-1.5 text-sm">
                <span className="block font-medium">Difficulty</span>
                <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </label>
              <Field label="Estimated seconds" type="number" min={10} max={1800} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
            </div>

            <fieldset className="space-y-3">
              <legend className="font-medium">Options and the correct answer</legend>
              {errors.options ? <p className="text-xs text-danger-soft">{errors.options}</p> : null}
              {errors.correct ? <p className="text-xs text-danger-soft">{errors.correct}</p> : null}
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input type="radio" name="correct" aria-label={`Option ${i + 1} is correct`} className="size-4 accent-brand" checked={correct === i + 1} onChange={() => setCorrect(i + 1)} />
                  <span className="w-6 text-sm text-ink-muted">{String.fromCharCode(65 + i)}.</span>
                  <input
                    aria-label={`Option ${i + 1}`}
                    className={cn('h-10 min-w-0 flex-1 rounded-control border bg-canvas px-3', errors[`option-${i}`] ? 'border-danger' : 'border-line-strong')}
                    value={o}
                    maxLength={1000}
                    onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  {options.length > MIN_OPTIONS ? (
                    <button type="button" className="text-sm text-ink-muted underline" onClick={() => {
                      setOptions((list) => list.filter((_, j) => j !== i))
                      setCorrect((c) => (c === i + 1 ? 1 : c > i + 1 ? c - 1 : c))
                    }}>Remove</button>
                  ) : null}
                </div>
              ))}
              {options.length < MAX_OPTIONS ? (
                <Button variant="ghost" onClick={() => setOptions((l) => [...l, ''])}>Add option</Button>
              ) : null}
            </fieldset>

            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Explanation (shown to students after release)</span>
              <textarea className="min-h-24 w-full rounded-control border border-line-strong bg-canvas p-3" value={explanation} maxLength={8000} onChange={(e) => setExplanation(e.target.value)} />
            </label>

            <div className="flex flex-wrap gap-3 border-t border-line pt-4">
              <Button type="submit" loading={save.isPending}>{detail ? (locked ? 'Save as new version' : 'Save changes') : 'Save question'}</Button>
              <Button variant="ghost" onClick={() => navigate('/admin/questions')}>Back to bank</Button>
            </div>
          </Card>
        </form>

        <aside className="space-y-6">
          {detail ? (
            <Card className="space-y-3 p-5" aria-label="Checks">
              <h2 className="font-semibold">Checks</h2>
              <ul className="space-y-3">
                {detail.checks.map((c: Check) => (
                  <li key={c.check} className="space-y-1 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{CHECK_NAME[c.check] ?? c.check}</span>
                      <Badge tone={CHECK_TONE[c.outcome] ?? 'neutral'}>{c.outcome}</Badge>
                    </div>
                    <p className="text-xs text-ink-muted">{c.message}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {detail && detail.review_status !== 'ADMIN_APPROVED' ? (
            <Card className="space-y-4 p-5">
              <h2 className="font-semibold">Approve</h2>
              <p className="text-sm text-ink-muted">Approval is your decision. The system never approves a question on its own.</p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4 accent-brand" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={blocked || !hasKey} />
                <span>I have checked that the marked option is the correct answer and the explanation is right.</span>
              </label>
              {blocked ? <p className="text-xs text-danger-soft">Fix the failed checks before approving.</p> : null}
              <Button disabled={!confirmed || blocked || !hasKey} loading={approve.isPending} onClick={() => approve.mutate()}>Approve question</Button>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

