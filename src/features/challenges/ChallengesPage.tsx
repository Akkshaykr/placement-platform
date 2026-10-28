import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { listChallenges } from '@/features/assessment/api'
import type { Challenge, ChallengeState } from '@/features/assessment/schemas'
import { DIFFICULTY_LABEL, STATE_LABEL, STATE_TONE, formatWindow } from './labels'
import { cn } from '@/lib/cn'

type Tab = 'open' | 'upcoming' | 'completed'

const TABS: { key: Tab; label: string; states: ChallengeState[] }[] = [
  { key: 'open', label: 'Open now', states: ['OPEN'] },
  { key: 'upcoming', label: 'Upcoming', states: ['UPCOMING'] },
  { key: 'completed', label: 'Completed', states: ['COMPLETED', 'CANCELLED'] },
]

export function ChallengesPage() {
  const [tab, setTab] = useState<Tab>('open')
  const query = useQuery({ queryKey: ['challenges', 'student'], queryFn: listChallenges })
  const active = TABS.find((t) => t.key === tab)!
  const items = (query.data ?? []).filter((c) => active.states.includes(c.state))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Aptitude challenges</h1>
        <p className="mt-2 text-ink-muted">Timed assessments. Your scores are calculated by the server, never by your browser.</p>
      </div>

      <div role="tablist" aria-label="Challenge status" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'border-brand text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {query.isError ? (
        <Alert tone="danger" title="Couldn’t load challenges">
          <span>Check your connection, then </span>
          <button type="button" className="underline" onClick={() => query.refetch()}>
            try again
          </button>
          .
        </Alert>
      ) : null}

      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2" role="status" aria-label="Loading challenges">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : items.length === 0 && !query.isError ? (
        <Card className="p-8 text-center">
          <p className="font-medium">No challenges here yet</p>
          <p className="mt-2 text-sm text-ink-muted">
            {tab === 'open'
              ? 'Nothing is open right now. Check the upcoming list.'
              : tab === 'upcoming'
                ? 'No challenges are scheduled yet.'
                : 'You have no completed challenges yet.'}
          </p>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((c) => (
            <li key={c.id}>
              <ChallengeCard challenge={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ChallengeCard({ challenge: c }: { challenge: Challenge }) {
  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATE_TONE[c.state]}>{STATE_LABEL[c.state]}</Badge>
        <Badge>{DIFFICULTY_LABEL[c.difficulty]}</Badge>
        {c.topic_name ? <span className="text-xs text-ink-muted">{c.topic_name}</span> : null}
      </div>
      <div>
        <h2 className="text-lg font-semibold">{c.title}</h2>
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{c.description}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-ink-muted">Questions</dt>
        <dd>{c.question_count}</dd>
        <dt className="text-ink-muted">Time limit</dt>
        <dd>{c.time_limit_minutes} min</dd>
        <dt className="text-ink-muted">Window</dt>
        <dd className="text-xs">{formatWindow(c.start_at, c.end_at)}</dd>
        <dt className="text-ink-muted">Participants</dt>
        <dd>
          {c.registered_count}
          {c.participant_limit ? ` / ${c.participant_limit}` : ''}
          {c.is_full ? ' (full)' : ''}
        </dd>
      </dl>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-ink-muted">{c.is_registered ? 'You have joined' : 'Not joined yet'}</span>
        <Link
          to={`/challenges/${c.slug}`}
          className="inline-flex h-10 items-center rounded-control bg-brand px-4 text-sm font-medium text-ink hover:bg-brand-hover"
        >
          View challenge
        </Link>
      </div>
    </Card>
  )
}
