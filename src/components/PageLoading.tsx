import { Skeleton } from '@/components/ui/Skeleton'

export function PageLoading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto w-full max-w-5xl space-y-4 px-4 py-10">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  )
}
