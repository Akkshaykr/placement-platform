import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { ConfirmAction } from '@/components/ConfirmAction'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { toAppError } from '@/features/assessment/errors'
import { formatMarks } from '@/features/challenges/labels'
import { fromLocalInput, moveItem, slugify, toLocalInput, totalMarks } from '@/features/admin/forms'
import { useTopics } from '@/features/admin/useTopics'
import { TopicOptions } from '@/features/admin/TopicOptions'
import { getQuestion, listQuestions } from '@/features/admin/questions/api'
import type { QuestionDetail } from '@/features/admin/adminSchemas'
import {
  getAdminChallenge,
  publishChallenge,
  saveChallenge,
  setChallengeQuestions,
  transitionChallenge,
  type AdminChallengeDetail,
} from './api'
import { cn } from '@/lib/cn'

export function AdminChallengeEditorPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams()
  const query = useQuery({
    queryKey: ['admin', 'challenge', id],
    queryFn: () => getAdminChallenge(id!),
    enabled: mode === 'edit' && !!id,
    retry: 1,
  })

  if (mode === 'create') return <EditorSession key="new" detail={null} />
  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading challenge" className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96" />
      </div>
    )
  }
  if (query.isError) {
    const err = toAppError(query.error)
    if (err.code === 'NOT_FOUND') return <Navigate to="/admin/challenges" replace />
    return (
      <Alert tone="danger" title="Couldn’t load this challenge">
        {err.message}{' '}
        <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button>
      </Alert>
    )
  }
  return <EditorSession key={query.data.challenge.id} detail={query.data} />
}

interface FormState {
  slug: string
  title: string
  description: string
  instructions: string
  topicId: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  startLocal: string
  endLocal: string
  timeLimit: string
  targetCount: string
  maxAttempts: string
  participantLimit: string
  pointsPerCorrect: string
  negative: boolean
  penalty: string
  shuffleQuestions: boolean
  shuffleOptions: boolean
  resultRelease: 'IMMEDIATE' | 'AFTER_CLOSE' | 'NEVER'
  tamil: boolean
}

interface Item {
  question_id: string
  question_version_id: string
  stem: string
  marks: string
  review_status: string
}

function initialForm(d: AdminChallengeDetail | null): FormState {
  const c = d?.challenge
  return {
    slug: c?.slug ?? '',
    title: c?.title ?? '',
    description: c?.description ?? '',
    instructions: c?.instructions ?? '',
    topicId: c?.topic_id ?? '',
    difficulty: c?.difficulty ?? 'MEDIUM',
    startLocal: toLocalInput(c?.start_at),
    endLocal: toLocalInput(c?.end_at),
    timeLimit: String(c?.time_limit_minutes ?? 30),
    targetCount: String(c?.target_question_count ?? 10),
    maxAttempts: c?.max_attempts === null || c?.max_attempts === undefined ? '' : String(c.max_attempts),
    participantLimit: c?.participant_limit === null || c?.participant_limit === undefined ? '' : String(c.participant_limit),
    pointsPerCorrect: String(c?.points_per_correct ?? 1),
    negative: c?.negative_marking_enabled ?? false,
    penalty: String(c?.penalty_per_incorrect || 0.25),
    shuffleQuestions: c?.shuffle_questions ?? false,
    shuffleOptions: c?.shuffle_options ?? false,
    resultRelease: c?.result_release ?? 'IMMEDIATE',
    tamil: c?.languages.includes('ta') ?? false,
  }
}

function EditorSession({ detail }: { detail: AdminChallengeDetail | null }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const topics = useTopics()
  const [form, setForm] = useState<FormState>(() => initialForm(detail))
  const [items, setItems] = useState<Item[]>(() =>
    (detail?.questions ?? []).map((q) => ({
      question_id: q.question_id,
      question_version_id: q.question_version_id,
      stem: q.stem,
      marks: String(q.marks),
      review_status: q.review_status,
    })),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<{ tone: 'danger' | 'info'; text: string } | null>(null)
  const [preview, setPreview] = useState<QuestionDetail[] | null>(null)
  const id = detail?.challenge.id ?? null
  const isDraft = !detail || detail.challenge.status === 'DRAFT'
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  const refresh = () => {
    if (id) qc.invalidateQueries({ queryKey: ['admin', 'challenge', id] })
    qc.invalidateQueries({ queryKey: ['admin', 'challenges'] })
  }
  const fail = (e: unknown) => setBanner({ tone: 'danger', text: toAppError(e).message })

  const save = useMutation({
    mutationFn: async () => {
      const local = validate(form)
      setErrors(local)
      if (Object.keys(local).length > 0) throw new Error('Fix the highlighted fields.')
      return saveChallenge(id, payload(form))
    },
    onSuccess: (savedId) => {
      toast.success('Draft saved.')
      setBanner(null)
      if (!id) navigate(`/admin/challenges/${savedId}`, { replace: true })
      else refresh()
    },
    onError: fail,
  })

  const saveItems = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save the challenge details first.')
      return setChallengeQuestions(
        id,
        items.map((i) => ({ question_version_id: i.question_version_id, marks: i.marks.trim() ? Number(i.marks) : null })),
      )
    },
    onSuccess: () => { toast.success('Question list saved.'); refresh() },
    onError: fail,
  })

  const publish = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Save the challenge first.')
      return publishChallenge(id)
    },
    onSuccess: () => { toast.success('Challenge published. It is now locked.'); refresh() },
    onError: fail,
  })

  const transition = useMutation({
    mutationFn: async (action: 'CANCEL' | 'COMPLETE' | 'ARCHIVE' | 'DELETE') => {
      if (!id) throw new Error('Nothing to change.')
      return transitionChallenge(id, action)
    },
    onSuccess: (_d, action) => {
      toast.success(action === 'DELETE' ? 'Draft deleted.' : 'Challenge updated.')
      if (action === 'DELETE') navigate('/admin/challenges', { replace: true })
      else refresh()
    },
    onError: fail,
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  const selectedIds = new Set(items.map((i) => i.question_version_id))
  const pointsDefault = Number(form.pointsPerCorrect) || 1
  const target = Number(form.targetCount) || 0
  const tamilReady = (detail?.questions ?? []).filter((q) => q.tamil_ready && items.some((i) => i.question_version_id === q.question_version_id)).length

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={detail?.challenge.status === 'PUBLISHED' ? 'success' : 'neutral'}>
              {detail ? detail.challenge.status.charAt(0) + detail.challenge.status.slice(1).toLowerCase() : 'New draft'}
            </Badge>
            {detail ? <span className="text-sm text-ink-muted">{detail.challenge.registrations} registered · {detail.challenge.attempts} attempts</span> : null}
          </div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{detail ? detail.challenge.title || 'Untitled challenge' : 'New challenge'}</h1>
          {!isDraft ? (
            <p className="max-w-2xl text-sm text-ink-muted">
              This challenge is no longer a draft, so its content is locked to protect existing attempts. Use the lifecycle actions below.
            </p>
          ) : null}
        </div>
        {detail && detail.challenge.status !== 'DRAFT' ? (
          <Button variant="secondary" onClick={() => navigate(`/admin/challenges/${detail.challenge.id}/insights`)}>
            Participants and analytics
          </Button>
        ) : null}
      </div>

      {banner ? <Alert tone={banner.tone === 'danger' ? 'danger' : 'info'} title={banner.tone === 'danger' ? 'Action not completed' : undefined}>{banner.text}</Alert> : null}

      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3" aria-label="Challenge details">
        <Card className="space-y-5 p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold">Details</h2>
          <fieldset disabled={!isDraft} className="grid gap-5 md:grid-cols-2">
            <Field label="Title" value={form.title} error={errors.title} onChange={(e) => {
              const title = e.target.value
              setForm((f) => ({ ...f, title, slug: !detail && (f.slug === '' || f.slug === slugify(f.title)) ? slugify(title) : f.slug }))
            }} />
            <Field label="Slug (web address)" hint="Lowercase letters, numbers and hyphens." value={form.slug} error={errors.slug} onChange={(e) => set('slug', e.target.value)} />
            <label className="space-y-1.5 text-sm md:col-span-2">
              <span className="block font-medium">Description</span>
              <textarea className="min-h-24 w-full rounded-control border border-line-strong bg-canvas p-3" value={form.description} maxLength={4000} onChange={(e) => set('description', e.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm md:col-span-2">
              <span className="block font-medium">Instructions for students</span>
              <textarea className="min-h-20 w-full rounded-control border border-line-strong bg-canvas p-3" value={form.instructions} maxLength={4000} onChange={(e) => set('instructions', e.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Topic</span>
              <select className={cn('h-11 w-full rounded-control border bg-canvas px-3', errors.topicId ? 'border-danger' : 'border-line-strong')} value={form.topicId} onChange={(e) => set('topicId', e.target.value)} aria-invalid={!!errors.topicId || undefined}>
                <option value="">Choose a topic</option>
                <TopicOptions topics={topics.data ?? []} />
              </select>
              {errors.topicId ? <span className="text-xs text-danger-soft">{errors.topicId}</span> : null}
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Difficulty</span>
              <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={form.difficulty} onChange={(e) => set('difficulty', e.target.value as FormState['difficulty'])}>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </label>
            <Field label="Opens" type="datetime-local" value={form.startLocal} error={errors.start} onChange={(e) => set('startLocal', e.target.value)} />
            <Field label="Closes" type="datetime-local" value={form.endLocal} error={errors.end} onChange={(e) => set('endLocal', e.target.value)} />
            <Field label="Time limit (minutes)" type="number" min={1} max={300} value={form.timeLimit} error={errors.timeLimit} onChange={(e) => set('timeLimit', e.target.value)} />
            <Field label="Number of questions" type="number" min={1} max={100} value={form.targetCount} error={errors.targetCount} hint="Publishing requires exactly this many approved questions." onChange={(e) => set('targetCount', e.target.value)} />
            <Field label="Attempts per student" type="number" min={1} max={100} placeholder="Unlimited" value={form.maxAttempts} error={errors.maxAttempts} onChange={(e) => set('maxAttempts', e.target.value)} />
            <Field label="Participant limit" type="number" min={1} placeholder="No limit" value={form.participantLimit} error={errors.participantLimit} onChange={(e) => set('participantLimit', e.target.value)} />
            <Field label="Marks per correct answer" type="number" min={0.01} step="0.01" value={form.pointsPerCorrect} error={errors.points} onChange={(e) => set('pointsPerCorrect', e.target.value)} />
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Results shown to students</span>
              <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={form.resultRelease} onChange={(e) => set('resultRelease', e.target.value as FormState['resultRelease'])}>
                <option value="IMMEDIATE">Straight after submitting</option>
                <option value="AFTER_CLOSE">After the challenge closes</option>
                <option value="NEVER">Never</option>
              </select>
            </label>
            <div className="space-y-3 text-sm md:col-span-2">
              <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand" checked={form.negative} onChange={(e) => set('negative', e.target.checked)} />Negative marking for wrong answers</label>
              {form.negative ? <Field label="Penalty per wrong answer" type="number" min={0.01} step="0.01" value={form.penalty} error={errors.penalty} onChange={(e) => set('penalty', e.target.value)} /> : null}
              <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand" checked={form.shuffleQuestions} onChange={(e) => set('shuffleQuestions', e.target.checked)} />Shuffle question order for each student</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand" checked={form.tamil} onChange={(e) => set('tamil', e.target.checked)} />Also offer this challenge in Tamil (English is always offered)</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand" checked={form.shuffleOptions} onChange={(e) => set('shuffleOptions', e.target.checked)} />Shuffle answer options for each student</label>
            </div>
          </fieldset>
          {isDraft ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button type="submit" loading={save.isPending}>Save draft</Button>
              {detail ? (
                <ConfirmAction label="Delete draft" question="Delete this draft permanently?" confirmLabel="Delete" onConfirm={() => transition.mutateAsync('DELETE').then(() => undefined, () => undefined)} loading={transition.isPending} />
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">Readiness</h2>
          <ul className="space-y-2 text-sm">
            <Check ok={!!form.topicId} label="Topic chosen" />
            <Check ok={!!form.startLocal && !!form.endLocal} label="Schedule set" />
            <Check ok={items.length === target && target > 0} label={`${items.length} of ${target} questions added`} />
            <Check ok={items.every((i) => i.review_status === 'ADMIN_APPROVED')} label="Every question approved" />
            {form.tamil ? <Check ok={tamilReady === items.length && items.length > 0} label={`Tamil ready: ${tamilReady} of ${items.length} questions`} /> : null}
          </ul>
          <p className="text-sm text-ink-muted">Total marks: {formatMarks(totalMarks(items.map((i) => ({ marks: i.marks.trim() ? Number(i.marks) : null })), pointsDefault))}</p>
          {detail?.challenge.status === 'DRAFT' || !detail ? (
            <ConfirmAction
              label="Publish and schedule"
              question="Publishing freezes the questions and settings. Continue?"
              confirmLabel="Publish"
              variant="primary"
              disabled={!id}
              loading={publish.isPending}
              onConfirm={() => publish.mutateAsync().then(() => undefined, () => undefined)}
            />
          ) : null}
          {detail && detail.challenge.status === 'PUBLISHED' ? (
            <div className="flex flex-col gap-3">
              <ConfirmAction label="Complete now" question="Submit all running attempts now and close the challenge?" confirmLabel="Complete" onConfirm={() => transition.mutateAsync('COMPLETE').then(() => undefined, () => undefined)} loading={transition.isPending} />
              <ConfirmAction label="Cancel challenge" question="Cancel this challenge? Students will not be able to start it." confirmLabel="Cancel challenge" onConfirm={() => transition.mutateAsync('CANCEL').then(() => undefined, () => undefined)} loading={transition.isPending} />
            </div>
          ) : null}
          {detail && (detail.challenge.status === 'CLOSED' || detail.challenge.status === 'CANCELLED') ? (
            <ConfirmAction label="Archive" question="Archive this challenge? It stays in history." confirmLabel="Archive" onConfirm={() => transition.mutateAsync('ARCHIVE').then(() => undefined, () => undefined)} loading={transition.isPending} />
          ) : null}
        </Card>
      </form>

      <section aria-labelledby="qs-h" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="qs-h" className="text-lg font-semibold">Questions in this assessment</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPreview(null)} disabled={items.length === 0}>Hide preview</Button>
            <Button variant="secondary" disabled={items.length === 0} onClick={async () => {
              try {
                const details = await Promise.all(items.map((i) => getQuestion(i.question_id)))
                setPreview(details)
              } catch (e) { fail(e) }
            }}>Preview as student</Button>
          </div>
        </div>

        {items.length === 0 ? (
          <Card className="p-6 text-sm text-ink-muted">No questions yet. Add approved questions from the list below.</Card>
        ) : (
          <ol className="space-y-3">
            {items.map((item, i) => (
              <li key={item.question_version_id}>
                <Card className="flex flex-wrap items-start gap-4 p-4">
                  <span className="w-8 pt-1 font-semibold tabular-nums text-ink-muted">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-line">{item.stem}</p>
                    <p className="mt-1 text-xs text-ink-muted">{item.review_status === 'ADMIN_APPROVED' ? 'Approved' : 'Not approved: publishing will refuse this'}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-ink-muted">Marks</span>
                    <input
                      type="number"
                      min={0.01}
                      step="0.01"
                      aria-label={`Marks for question ${i + 1}`}
                      placeholder={String(pointsDefault)}
                      className="h-9 w-24 rounded-control border border-line-strong bg-canvas px-2"
                      value={item.marks}
                      disabled={!isDraft}
                      onChange={(e) => setItems((list) => list.map((x, j) => (j === i ? { ...x, marks: e.target.value } : x)))}
                    />
                  </label>
                  {isDraft ? (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="md" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => setItems((l) => moveItem(l, i, -1))}>↑</Button>
                      <Button variant="ghost" size="md" aria-label={`Move question ${i + 1} down`} disabled={i === items.length - 1} onClick={() => setItems((l) => moveItem(l, i, 1))}>↓</Button>
                      <Button variant="ghost" size="md" aria-label={`Remove question ${i + 1}`} onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>Remove</Button>
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        )}

        {preview ? <PreviewPanel questions={preview} shuffleOptions={form.shuffleOptions} /> : null}

        {isDraft && id ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button loading={saveItems.isPending} onClick={() => saveItems.mutate()}>Save question list</Button>
          </div>
        ) : null}

        {isDraft ? <QuestionPicker selected={selectedIds} onAdd={(q) => setItems((l) => [...l, q])} disabled={!isDraft} /> : null}
      </section>
    </div>
  )
}

function PreviewPanel({ questions, shuffleOptions }: { questions: QuestionDetail[]; shuffleOptions: boolean }) {
  return (
    <Card className="space-y-4 p-6" aria-label="Student preview">
      <p className="text-sm text-ink-muted">
        This is how students see the questions. Correct answers are never shown to students in preview.
        {shuffleOptions ? ' Options are shuffled for each student.' : ''}
      </p>
      <ol className="space-y-5">
        {questions.map((q, i) => (
          <li key={q.question_version_id} className="space-y-2">
            <p className="font-medium">{i + 1}. {q.stem}</p>
            <ul className="space-y-1 pl-5 text-sm">
              {q.options.map((o) => (
                <li key={o.id} className="list-disc">{o.body}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function QuestionPicker({ selected, onAdd, disabled }: { selected: Set<string>; onAdd: (i: Item) => void; disabled: boolean }) {
  const [q, setQ] = useState('')
  const [applied, setApplied] = useState('')
  const approved = useQuery({
    queryKey: ['admin', 'questions', 'approved', applied],
    queryFn: () => listQuestions({ review_status: 'ADMIN_APPROVED', q: applied }),
  })
  return (
    <Card className="space-y-4 p-5">
      <h3 className="font-medium">Add approved questions</h3>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setApplied(q) }}>
        <Field label="Search approved questions" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-80" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {approved.isError ? <Alert tone="danger">{toAppError(approved.error).message}</Alert> : null}
      {approved.isPending ? <Skeleton className="h-16" /> : (approved.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-muted">No approved questions match. Approve questions in the question bank first.</p>
      ) : (
        <ul className="divide-y divide-line">
          {(approved.data ?? []).map((r) => (
            <li key={r.question_version_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="min-w-0 flex-1 text-sm">{r.stem}</span>
              <Button variant="secondary" disabled={disabled || selected.has(r.question_version_id)} onClick={() => onAdd({ question_id: r.question_id, question_version_id: r.question_version_id, stem: r.stem, marks: '', review_status: r.review_status })}>
                {selected.has(r.question_version_id) ? 'Added' : 'Add'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className={cn('inline-block size-2.5 rounded-full', ok ? 'bg-success' : 'bg-line-strong')} />
      <span className={ok ? 'text-ink' : 'text-ink-muted'}>{label}</span>
      <span className="sr-only">{ok ? '(done)' : '(to do)'}</span>
    </li>
  )
}

function validate(f: FormState): Record<string, string> {
  const e: Record<string, string> = {}
  if (f.title.trim().length < 3) e.title = 'Use at least 3 characters.'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.slug) || f.slug.length < 3) e.slug = 'Use lowercase letters, numbers and hyphens.'
  const start = fromLocalInput(f.startLocal)
  const end = fromLocalInput(f.endLocal)
  if (start && end && new Date(end) <= new Date(start)) e.end = 'Closing must be after opening.'
  const minutes = Number(f.timeLimit)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 300) e.timeLimit = 'Between 1 and 300 minutes.'
  const count = Number(f.targetCount)
  if (!Number.isInteger(count) || count < 1 || count > 100) e.targetCount = 'Between 1 and 100.'
  if (f.maxAttempts && (!Number.isInteger(Number(f.maxAttempts)) || Number(f.maxAttempts) < 1)) e.maxAttempts = 'At least 1, or leave blank.'
  if (f.participantLimit && (!Number.isInteger(Number(f.participantLimit)) || Number(f.participantLimit) < 1)) e.participantLimit = 'At least 1, or leave blank.'
  if (!(Number(f.pointsPerCorrect) > 0)) e.points = 'Must be above zero.'
  if (f.negative && !(Number(f.penalty) > 0)) e.penalty = 'Must be above zero when negative marking is on.'
  return e
}

function payload(f: FormState): Record<string, unknown> {
  return {
    slug: f.slug,
    title: f.title.trim(),
    description: f.description,
    instructions: f.instructions,
    topic_id: f.topicId || null,
    difficulty: f.difficulty,
    start_at: fromLocalInput(f.startLocal),
    end_at: fromLocalInput(f.endLocal),
    time_limit_minutes: Number(f.timeLimit),
    target_question_count: Number(f.targetCount),
    max_attempts: f.maxAttempts ? Number(f.maxAttempts) : null,
    participant_limit: f.participantLimit ? Number(f.participantLimit) : null,
    points_per_correct: Number(f.pointsPerCorrect),
    negative_marking_enabled: f.negative,
    penalty_per_incorrect: f.negative ? Number(f.penalty) : 0,
    shuffle_questions: f.shuffleQuestions,
    shuffle_options: f.shuffleOptions,
    result_release: f.resultRelease,
    languages: f.tamil ? ['en', 'ta'] : ['en'],
  }
}

