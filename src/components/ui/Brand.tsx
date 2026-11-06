import { Link } from 'react-router'
import { APP_NAME } from '@/lib/brand'

/** Header logo. The image is decorative beside the name, so the name is kept as the accessible label. */
export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-3 rounded-control whitespace-nowrap text-ink" aria-label={APP_NAME}>
      <img src="/images/kanithamedhai-logo.png" alt="" className="h-14 w-auto shrink-0 object-contain sm:h-20" />
      {/* <span className="text-xl font-bold tracking-tight sm:text-2xl">{APP_NAME}</span> */}
    </Link>
  )
}
