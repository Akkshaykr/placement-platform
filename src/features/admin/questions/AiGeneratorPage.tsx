import { useMutation, useQuery } from '@tanstack/react-query'
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
import { aiStatus, generateQuestions, type GenerateResult } from './api'

export function AiGeneratorPage() {
  const status = useQuery({ queryKey: ['admin', 'ai-status'], queryFn: aiStatus, retry: 1 })
  const topics = useTopics()
  const [topicId, setTopicId] = useState('')
  const [subtopic, setSubtopic] = useState('')
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState('5')
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>('MEDIUM')
  const [style, setStyle] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const generate = useMutation({ mutationFn: (body: Record<string, unknown>) => generateQuestions(body), onSuccess: () => status.refetch() })
  const result: GenerateResult | undefined = generate.data
  const max = status.data?.max_questions_per_request ?? 10
  const remaining = status.data ? Math.max(0, status.data.daily_limit - status.data.used_today) : 0

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!topicId) return setFormError('Choose a topic.')
    if (prompt.trim().length < 10) return setFormError('Describe the questions in at least 10 characters.')
    const n = Number(count)
    if (!Number.isInteger(n) || n < 1 || n > max) return setFormError(`Ask for 1 to ${max} questions.`)
    generate.mutate({ topic_id: topicId, subtopic, prompt, count: n, difficulty, style_notes: style })
  }

  const errorText = generate.error ? (generate.error instanceof Error ? generate.error.message : toAppError(generate.error).message) : null

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Generate questions with AI</h1>
        <p className="mt-2 text-ink-muted">
          The model drafts questions into the bank. Nothing is published. Each draft needs your review and approval.
        </p>
      </div>

      {status.isPending ? <Skeleton className="h-20" /> : status.data ? (
        <Card className="flex flex-wrap items-center gap-4 p-5 text-sm">
          <Badge tone={status.data.enabled ? 'success' : 'warning'}>{status.data.enabled ? 'Generation on' : 'Generation off'}</Badge>
          <span>{remaining} of {status.data.daily_limit} requests left today</span>
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
              <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                <option value="">Choose a topic</option>
                <TopicOptions topics={topics.data ?? []} />
              </select>
            </label>
            <Field label="Subtopic (optional)" value={subtopic} onChange={(e) => setSubtopic(e.target.value)} />
            <label className="space-y-1.5 text-sm">
              <span className="block font-medium">Difficulty</span>
              <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </label>
            <Field label="How many" type="number" min={1} max={max} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
          <label className="space-y-1.5 text-sm block">
            <span className="block font-medium">What should the questions test?</span>
            <textarea className="min-h-28 w-full rounded-control border border-line-strong bg-canvas p-3" value={prompt} maxLength={2000} onChange={(e) => setPrompt(e.target.value)} placeholder="For example: two-person work-rate problems with two or three workers, moderate difficulty, with whole-number answers." />
          </label>
          <Field label="Style notes (optional)" value={style} maxLength={500} onChange={(e) => setStyle(e.target.value)} />
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Button type="submit" loading={generate.isPending} disabled={!status.data?.enabled || remaining === 0}>
            {generate.isPending ? 'Generating…' : 'Generate drafts'}
          </Button>
        </Card>
      </form>

      {errorText && !generate.isPending ? (
        <Alert tone="danger" title="Generation didn’t finish">{errorText}</Alert>
      ) : null}

      {result ? (
        <Card className="space-y-4 p-6" aria-live="polite">
          <h2 className="text-lg font-semibold">{result.produced} draft{result.produced === 1 ? '' : 's'} created</h2>
          {result.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-warning">
              {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          ) : null}
          <ul className="divide-y divide-line">
            {result.question_ids.map((id) => (
              <li key={id} className="flex items-center justify-between py-3 text-sm">
                <span>Draft question</span>
                <Link className="text-brand-soft underline" to={`/admin/questions/${id}`}>Review and approve</Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}
