import { Link } from 'react-router'
import { buttonStyles } from '@/components/ui/buttonStyles'

export function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">You don’t have access to this page</h1>
      <p className="mt-3 text-ink-muted">This area is for administrators. If you believe you should have access, contact the person who runs this platform.</p>
      <Link to="/dashboard" className={`${buttonStyles('secondary')} mt-8`}>
        Back to your dashboard
      </Link>
    </div>
  )
}
