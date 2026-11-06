import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'
import { toAppError } from '@/features/assessment/errors'
import { useTopics } from '@/features/admin/useTopics'
import { TopicOptions } from '@/features/admin/TopicOptions'
import { aiStatus, generateQuestions } from './api'

/** Each request asks for this many questions. A slow or failed chunk never discards the others. */
const CHUNK_SIZE = 3

interface Body {
  topic_id: string
  subtopic: string
  prompt: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  style_notes: string
}

/** 10 questions with CHUNK_SIZE 3 becomes [3, 3, 3, 1]. */
function chunkSizes(total: number): number[] {
  const sizes: number[] = []
  for (let left = total; left > 0; left -= CHUNK_SIZE) sizes.push(Math.min(CHUNK_SIZE, left))
  return sizes
}

export function AiGeneratorPage() {
  const status = useQuery({ queryKey: ['admin', 'ai-status'], queryFn: aiStatus, retry: 1 })
  const topics = useTopics()
  const [topicId, setTopicId] = useState('')
  const [subtopic, setSubtopic] = useState('')
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState('10')
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>('HARD')
  const [style, setStyle] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [createdIds, setCreatedIds] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [failed, setFailed] = useState<{ size: number; message: string }[]>([])
  const [lastBody, setLastBody] = useState<Body | null>(null)

  const max = status.data?.max_questions_per_request ?? 10
  const remaining = status.data ? Math.max(0, status.data.daily_limit - status.data.used_today) : 0

  /** Sends one request per chunk, one after another. Each chunk's outcome is recorded on its own. */
  async function runChunks(body: Body, sizes: number[]) {
    setRunning(true)
    setFailed([])
    setProgress({ done: 0, total: sizes.length })
    const failures: { size: number; message: string }[] = []

    for (let i = 0; i < sizes.length; i++) {
      try {
        const result = await generateQuestions({ ...body, count: sizes[i] })
        setCreatedIds((ids) => [...ids, ...result.question_ids])
        setWarnings((w) => [...w, ...result.warnings])
      } catch (e) {
        failures.push({ size: sizes[i]!, message: e instanceof Error ? e.message : 'Unknown error' })
      }
      setProgress({ done: i + 1, total: sizes.length })
    }

    setFailed(failures)
    setRunning(false)
    status.refetch()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!topicId) return setFormError('Choose a topic.')
    if (prompt.trim().length < 10) return setFormError('Describe the questions in at least 10 characters.')
    const n = Number(count)
    if (!Number.isInteger(n) || n < 1 || n > max) return setFormError(`Ask for 1 to ${max} questions.`)

    const sizes = chunkSizes(n)
    if (sizes.length > remaining) {
      return setFormError(`This needs ${sizes.length} requests, and you have ${remaining} left today.`)
    }

    const body: Body = { topic_id: topicId, subtopic, prompt, difficulty, style_notes: style }
    setLastBody(body)
    setCreatedIds([])
    setWarnings([])
    void runChunks(body, sizes)
  }

  const retryFailed = () => {
    if (lastBody) void runChunks(lastBody, failed.map((f) => f.size))
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Generate questions with AI</h1>
        <p className="mt-2 text-ink-muted">
          The model drafts questions into the bank. Nothing is published. Each draft needs your review and approval.
        </p>
      </div>

      {status.isPending ? (
        <Skeleton className="h-20" />
      ) : status.data ? (
        <Card className="flex flex-wrap items-center gap-4 p-5 text-sm">
          <Badge tone={status.data.enabled ? 'success' : 'warning'}>{status.data.enabled ? 'Generation on' : 'Generation off'}</Badge>
          <span>
            {remaining} of {status.data.daily_limit} requests left today
          </span>
          <span className="text-ink-muted">Up to {max} questions per request</span>
        </Card>
      ) : (
        <Alert tone="danger">Couldn’t read the generator status. {toAppError(status.error).message}</Alert>
      )}

      {status.data && !status.data.enabled ? (
        <Alert tone="warning" title="AI generation is turned off">
          An administrator enables it in the app settings table (ai.enabled). You can keep writing questions by hand meanwhile.
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3" aria-label="Generation request">
        <Card className="space-y-5 p-6 lg:col-span-2">
          <div className="grid gap-5 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Topic</span>
              <select
                className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3"
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
              >
                <option value="">Choose a topic</option>
                <TopicOptions topics={topics.data ?? []} />
              </select>
            </label>
            <Field label="Subtopic (optional)" value={subtopic} onChange={(e) => setSubtopic(e.target.value)} />
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Difficulty</span>
              <select
                className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
              >
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </label>
            <Field label="How many" type="number" min={1} max={max} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="block font-medium">What should the questions test?</span>
            <textarea
              className="min-h-28 w-full rounded-control border border-line-strong bg-canvas p-3"
              value={prompt}
              maxLength={2000}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="For example: two-person work-rate problems with two or three workers, moderate difficulty, with whole-number answers."
            />
          </label>
          <Field label="Style notes (optional)" value={style} maxLength={500} onChange={(e) => setStyle(e.target.value)} />
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Button type="submit" loading={running} disabled={!status.data?.enabled || remaining === 0 || running}>
            {running ? 'Generating…' : 'Generate drafts'}
          </Button>
        </Card>
      </form>

      {running ? (
        <Alert tone="info" title="Generating">
          Chunk {Math.min(progress.done + 1, progress.total)} of {progress.total}. A failure only affects its own chunk.
        </Alert>
      ) : null}

      {failed.length > 0 ? (
        <Alert tone="danger" title={`${failed.length} chunk${failed.length === 1 ? '' : 's'} didn’t finish`}>
          <p>{failed[0]!.message}</p>
          <div className="mt-3">
            <Button variant="secondary" loading={running} onClick={retryFailed}>
              Retry failed chunks
            </Button>
          </div>
        </Alert>
      ) : null}

      {createdIds.length > 0 || warnings.length > 0 ? (
        <Card className="space-y-4 p-6" aria-live="polite">
          <h2 className="text-lg font-semibold">
            {createdIds.length} draft{createdIds.length === 1 ? '' : 's'} created
          </h2>
          {warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-warning">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <ul className="divide-y divide-line">
            {createdIds.map((id) => (
              <li key={id} className="flex items-center justify-between py-3 text-sm">
                <span>Draft question</span>
                <Link className="text-brand-soft underline" to={`/admin/questions/${id}`}>
                  Review and approve
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}