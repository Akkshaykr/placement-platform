import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'
import { STATE_LABEL, STATE_TONE, formatWindow } from '@/features/challenges/labels'
import { toAppError } from '@/features/assessment/errors'
import { useTopics } from '@/features/admin/useTopics'
import { TopicOptions } from '@/features/admin/TopicOptions'
import { listAdminChallenges, type ChallengeFilters } from './api'
import { fromLocalInput } from '@/features/admin/forms'

const STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED', 'ARCHIVED'] as const

export function AdminChallengesPage() {
  const [draft, setDraft] = useState<ChallengeFilters>({})
  const [applied, setApplied] = useState<ChallengeFilters>({})
  const topics = useTopics()
  const query = useQuery({
    queryKey: ['admin', 'challenges', applied],
    queryFn: () =>
      listAdminChallenges({
        ...applied,
        from: applied.from ? (fromLocalInput(`${applied.from}T00:00`) ?? undefined) : undefined,
        to: applied.to ? (fromLocalInput(`${applied.to}T23:59`) ?? undefined) : undefined,
      }),
  })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Challenges</h1>
          <p className="mt-2 text-ink-muted">Create, schedule and manage aptitude challenges.</p>
        </div>
        <Link to="/admin/challenges/new" className="inline-flex h-10 items-center rounded-control bg-brand px-4 text-sm font-medium text-ink hover:bg-brand-hover">
          New challenge
        </Link>
      </div>

      <Card className="p-4">
        <form
          className="grid gap-4 md:grid-cols-3 xl:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault()
            setApplied(draft)
          }}
        >
          <Field label="Search" placeholder="Title or slug" value={draft.q ?? ''} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
          <label className="space-y-1.5 text-sm">
            <span className="block font-medium">Status</span>
            <select className="h-11 w-full rounded-control border border-line-strong bg-canvas px-3" value={draft.status ?? ''} onChange={(e) => setDraft({ ...draft, status: e.target.value || undefined })}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
            </select>
          </label>
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
          <Field label="Starts on or after" type="date" value={draft.from ?? ''} onChange={(e) => setDraft({ ...draft, from: e.target.value || undefined })} />
          <Field label="Starts on or before" type="date" value={draft.to ?? ''} onChange={(e) => setDraft({ ...draft, to: e.target.value || undefined })} />
          <div className="flex items-end gap-2 md:col-span-3 xl:col-span-6">
            <Button type="submit">Apply filters</Button>
            <Button variant="ghost" onClick={() => { setDraft({}); setApplied({}) }}>Clear</Button>
          </div>
        </form>
      </Card>

      {query.isError ? <Alert tone="danger" title="Couldn’t load challenges">{toAppError(query.error).message}</Alert> : null}

      {query.isPending ? (
        <div role="status" aria-label="Loading challenges" className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : (query.data ?? []).length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-medium">No challenges match these filters</p>
          <p className="mt-2 text-sm text-ink-muted">Clear the filters, or create a new challenge.</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Challenge</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Window</th>
                <th scope="col" className="px-4 py-3 font-medium">Registered</th>
                <th scope="col" className="px-4 py-3 font-medium">Completed</th>
                <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {(query.data ?? []).map((c) => (
                <tr key={c.id} className="border-t border-line align-top">
                  <th scope="row" className="px-4 py-3 text-left">
                    <span className="font-medium">{c.title}</span>
                    <span className="block text-xs font-normal text-ink-muted">{c.topic_name ?? 'No topic'} · {c.slug}</span>
                  </th>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <Badge>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge>
                      {c.status === 'PUBLISHED' ? <Badge tone={STATE_TONE[c.state as keyof typeof STATE_TONE] ?? 'neutral'}>{STATE_LABEL[c.state as keyof typeof STATE_LABEL] ?? c.state}</Badge> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">{formatWindow(c.start_at, c.end_at)}</td>
                  <td className="px-4 py-3 tabular-nums">{c.registrations}</td>
                  <td className="px-4 py-3 tabular-nums">{c.completed_attempts}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link className="text-brand-soft underline" to={`/admin/challenges/${c.id}`}>
                      {c.status === 'DRAFT' ? 'Edit' : 'Manage'}
                    </Link>
                    {c.status !== 'DRAFT' ? (
                      <Link className="ml-4 text-brand-soft underline" to={`/admin/challenges/${c.id}/insights`}>
                        Insights
                      </Link>
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
