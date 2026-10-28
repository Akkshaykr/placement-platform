import type { ReactNode } from 'react'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

interface StatCardProps {
  label: string
  value: number | undefined
  loading: boolean
  error: boolean
  definition: ReactNode
}

/** A metric with its definition printed next to it, so every number can be traced to its source. */
export function StatCard({ label, value, loading, error, definition }: StatCardProps) {
  return (
    <Card className="p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <div className="mt-2 min-h-10">
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : error ? (
          <p className="text-sm text-danger-soft">Couldn’t load this figure.</p>
        ) : (
          <p className="text-3xl font-semibold tabular-nums">{value}</p>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-muted">{definition}</p>
    </Card>
  )
}
