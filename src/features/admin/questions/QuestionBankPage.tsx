import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { ConfirmAction } from '@/components/ConfirmAction'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { toAppError } from '@/features/assessment/errors'
import { useTopics } from '@/features/admin/useTopics'
import { TopicOptions } from '@/features/admin/TopicOptions'
import { deleteQuestion, listQuestions, type QuestionFilters } from './api'

const REVIEW_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ADMIN_APPROVED: 'success',
  WARNING: 'warning',
  FAILED: 'danger',
  AUTO_PASSED: 'neutral',
  DRAFT: 'neutral',
  REJECTED: 'danger',
}
const REVIEW_TEXT: Record<string, string> = {
  ADMIN_APPROVED: 'Approved',
  WARNING: 'Needs review',
  FAILED: 'Failed checks',
  AUTO_PASSED: 'Passed checks',
  DRAFT: 'Draft',
  REJECTED: 'Rejected',
}

export function QuestionBankPage() {
  const [draft, setDraft] = useState<QuestionFilters>({})
  const [applied, setApplied] = useState<QuestionFilters>({})
  const topics = useTopics()
  const qc = useQueryClient()
  const toast = useToast()
  const query = useQuery({ queryKey: ['admin', 'questions', applied], queryFn: () => listQuestions(applied) })
  const remove = useMutation({
    mutationFn: (id: string) => deleteQuestion(id),
    onSuccess: () => { toast.success('Question deleted.'); qc.invalidateQueries({ queryKey: ['admin', 'questions'] }) },
    onError: (e) => toast.error(toAppError(e).message),
  })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Question bank</h1>
          <p className="mt-2 text-ink-muted">Only approved questions can be added to a challenge. Students never see answer keys.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/ai-generator" className="inline-flex h-10 items-center rounded-control border border-line-strong px-4 text-sm font-medium hover:border-brand-soft">Generate with AI</Link>
          <Link to="/admin/questions/new" className="inline-flex h-10 items-center rounded-control bg-brand px-4 text-sm font-medium text-ink hover:bg-brand-hover">New question</Link>
        </div>
      </div>

      <Card className="p-4">
        <form className="grid gap-4 md:grid-cols-3 xl:grid-cols-5" onSubmit={(e) => { e.preventDefault(); setApplied(draft) }}>
          <Field label="Search text" value={draft.q ?? ''} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
          <label className="space-y-1.5 text-sm">
            <span className="block font-medium">Topic</span>
            <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={draft.topic_id ?? ''} onChange={(e) => setDraft({ ...draft, topic_id: e.target.value || undefined })}>
              <option value="">All topics</option>
              <TopicOptions topics={topics.data ?? []} />
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="block font-medium">Difficulty</span>
            <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={draft.difficulty ?? ''} onChange={(e) => setDraft({ ...draft, difficulty: e.target.value || undefined })}>
              <option value="">All</option>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="block font-medium">Review status</span>
            <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={draft.review_status ?? ''} onChange={(e) => setDraft({ ...draft, review_status: e.target.value || undefined })}>
              <option value="">All</option>
              {Object.keys(REVIEW_TEXT).map((k) => <option key={k} value={k}>{REVIEW_TEXT[k]}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="block font-medium">Origin</span>
            <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={draft.origin ?? ''} onChange={(e) => setDraft({ ...draft, origin: e.target.value || undefined })}>
              <option value="">All</option>
              <option value="MANUAL">Written by hand</option>
              <option value="AI">AI-generated</option>
            </select>
          </label>
          <div className="flex items-end gap-2 md:col-span-3 xl:col-span-5">
            <Button type="submit">Apply filters</Button>
            <Button variant="ghost" onClick={() => { setDraft({}); setApplied({}) }}>Clear</Button>
          </div>
        </form>
      </Card>

      {query.isError ? <Alert tone="danger" title="Couldn’t load questions">{toAppError(query.error).message}</Alert> : null}

      {query.isPending ? (
        <div role="status" aria-label="Loading questions" className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      ) : (query.data ?? []).length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">No questions match</p>
          <p className="mt-2 text-sm text-ink-muted">Write one by hand or generate a batch with AI. Generated questions are drafts until you approve them.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Question</th>
                <th scope="col" className="px-4 py-3 font-medium">Topic</th>
                <th scope="col" className="px-4 py-3 font-medium">Difficulty</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {(query.data ?? []).map((q) => (
                <tr key={q.question_version_id} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <p className="line-clamp-2 max-w-md">{q.stem}</p>
                    <p className="mt-1 text-xs text-ink-muted">{q.origin === 'AI' ? 'AI-generated' : 'Written by hand'} · v{q.version_number}{q.locked ? ' · used by a published challenge' : ''}</p>
                  </td>
                  <td className="px-4 py-3">{q.topic_name ?? '-'}{q.subtopic ? <span className="block text-xs text-ink-muted">{q.subtopic}</span> : null}</td>
                  <td className="px-4 py-3">{q.difficulty.charAt(0) + q.difficulty.slice(1).toLowerCase()}</td>
                  <td className="px-4 py-3"><Badge tone={REVIEW_TONE[q.review_status] ?? 'neutral'}>{REVIEW_TEXT[q.review_status] ?? q.review_status}</Badge></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link className="text-brand-soft underline" to={`/admin/questions/${q.question_id}`}>{q.review_status === 'ADMIN_APPROVED' ? 'View' : 'Review'}</Link>
                    {!q.locked ? (
                      <span className="ml-4 inline-block">
                        <ConfirmAction label="Delete" question="Delete this question?" confirmLabel="Delete" onConfirm={() => remove.mutateAsync(q.question_id).then(() => undefined, () => undefined)} loading={remove.isPending} />
                      </span>
                    ) : null}
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
