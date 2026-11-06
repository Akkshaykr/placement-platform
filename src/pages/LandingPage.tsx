import { Link } from 'react-router'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { SpotlightLayer } from '@/components/fx/SpotlightLayer'
import { Reveal } from '@/components/fx/Reveal'
import { useReveal } from '@/components/fx/useReveal'
import { NeuralBackground } from '@/components/fx/NeuralBackground'
import { FloatingSymbols } from '@/components/fx/FloatingSymbols'
import { cn } from '@/lib/cn'
import { useAuth } from '@/features/auth/useAuth'

type PaletteState = 'answered' | 'marked' | 'current' | 'open'

const PALETTE: PaletteState[] = ['answered', 'answered', 'current', 'marked', 'open', 'open', 'answered', 'open', 'open', 'open']

const paletteStyle: Record<PaletteState, string> = {
  answered: 'border-brand bg-brand text-ink',
  marked: 'border-warning text-warning',
  current: 'border-brand-soft text-ink ring-2 ring-brand-soft/40',
  open: 'border-line-strong text-ink-muted',
}

function QuizSpecimen() {
  return (
    <figure className="mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-panel border border-line bg-surface shadow-2xl shadow-black/30">
        <div className="signal-rule" aria-hidden="true" />
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>Question 3 of 10</span>
            <span>Timed attempt</span>
          </div>
          <p className="text-lg font-medium leading-snug">A train 150 m long passes a pole in 10 seconds. What is its speed in km/h?</p>
          <ol className="space-y-2" aria-label="Answer options in the example">
            {['45 km/h', '54 km/h', '60 km/h', '72 km/h'].map((option, i) => (
              <li
                key={option}
                className={cn(
                  'flex items-center gap-3 rounded-control border px-4 py-3 text-sm',
                  i === 1 ? 'border-brand-soft bg-brand/15 text-ink' : 'border-line bg-canvas text-ink-muted',
                )}
              >
                <span className={cn('flex size-6 items-center justify-center rounded-full border text-xs', i === 1 ? 'border-brand-soft text-brand-soft' : 'border-line-strong')}>
                  {String.fromCharCode(65 + i)}
                </span>
                {option}
              </li>
            ))}
          </ol>
          <div>
            <p className="mb-2 text-xs text-ink-muted">Question palette</p>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((state, i) => (
                <span key={i} className={cn('flex size-8 items-center justify-center rounded-control border text-xs', paletteStyle[state])}>
                  {i + 1}
                </span>
              ))}
            </div>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
              <span>Filled: answered</span>
              <span>Amber: marked for review</span>
              <span>Outlined: not answered</span>
            </p>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-ink-muted">Example of the quiz screen. This is not a real challenge.</figcaption>
    </figure>
  )
}

const PRINCIPLES = [
  {
    title: 'Drafts stay private',
    body: 'A challenge is visible to students only while it is published and inside its schedule. Everything else is hidden by the database itself.',
  },
  {
    title: 'Answers stay out of reach',
    body: 'Correct answers and explanations are stored where the browser cannot query them, so they cannot be read from the page or the network.',
  },
  {
    title: 'History does not change',
    body: 'Editing a challenge later never alters the questions behind your past results. Each attempt keeps the exact version you took.',
  },
]

/** One principle. It fades in on its own when it scrolls into view. */
function PrincipleItem({ title, body, delayMs }: { title: string; body: string; delayMs: number }) {
  const ref = useReveal<HTMLDivElement>()
  return (
    <div ref={ref} style={{ transitionDelay: `${delayMs}ms` }}>
      <dt className="font-medium">{title}</dt>
      <dd className="mt-2 text-sm text-ink-muted">{body}</dd>
    </div>
  )
}

export function LandingPage() {
  const { status } = useAuth()
  const signedIn = status === 'authenticated'
  return (
    <div className="relative isolate overflow-hidden">
      {/* Decorative layers: behind all content, ignored by the pointer and by assistive technology. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <NeuralBackground />
        <FloatingSymbols />
      </div>

      <section>
        <SpotlightLayer className="mx-auto w-full max-w-6xl">
          <div className="grid items-center gap-12 px-4 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:py-20">
            <div>
              <div className="signal-rule mb-6 w-16" aria-hidden="true" />
              <h1 className="text-(length:--text-display) leading-[1.08] font-semibold">Vanakkam Students  Apttitude Challenge ku  Readya ???</h1>
              <p className="mt-5 max-w-xl text-lg text-ink-muted">
                Practise placement aptitude under exam-style time limits. Sign in to attempt published challenges, read the explanations after you submit, and track your accuracy by topic.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {signedIn ? (
                  <Link to="/dashboard" className={buttonStyles('primary', 'lg')}>
                    Go to your dashboard
                  </Link>
                ) : (
                  <>
                    <Link to="/register" className={buttonStyles('primary', 'lg')}>
                      Create account
                    </Link>
                    <Link to="/login" className={buttonStyles('secondary', 'lg')}>
                      Sign in
                    </Link>
                  </>
                )}
              </div>
            </div>
            <QuizSpecimen />
          </div>
        </SpotlightLayer>
      </section>

      <section aria-labelledby="principles" className="border-t border-line bg-surface/80">
        <div className="mx-auto w-full max-w-6xl px-4 py-14">
          <Reveal>
            <h2 id="principles" className="text-2xl font-semibold">
              Built so results stay trustworthy
            </h2>
          </Reveal>
          <dl className="mt-8 grid gap-8 md:grid-cols-3">
            {PRINCIPLES.map((p, i) => (
              <PrincipleItem key={p.title} title={p.title} body={p.body} delayMs={i * 120} />
            ))}
          </dl>
        </div>
      </section>
    </div>
  )
}
