import { Link } from 'react-router'
import { buttonStyles } from '@/components/ui/buttonStyles'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-sm text-ink-muted">Error 404</p>
      <h1 className="mt-2 text-2xl font-semibold">We can’t find that page</h1>
      <p className="mt-3 text-ink-muted">The address may be mistyped, or the page may have been moved.</p>
      <Link to="/" className={`${buttonStyles('secondary')} mt-8`}>
        Go to the home page
      </Link>
    </div>
  )
}
