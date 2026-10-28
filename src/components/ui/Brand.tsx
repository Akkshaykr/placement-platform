import { Link } from 'react-router'
import { APP_NAME } from '@/lib/brand'

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2.5 rounded-control font-semibold whitespace-nowrap tracking-tight text-ink">
      <span className="signal-bar h-5" aria-hidden="true" />
      <span>{APP_NAME}</span>
    </Link>
  )
}
