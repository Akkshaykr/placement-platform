/** Slowly drifting colour blobs behind a page. Decorative: hidden from assistive technology. */
export function AnimatedBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="fx-blob -top-40 -left-32 size-[32rem] bg-brand" />
      <div className="fx-blob top-1/3 -right-40 size-[28rem] bg-brand-soft" style={{ animationDelay: '-7s' }} />
      <div className="fx-blob -bottom-40 left-1/4 size-[26rem] bg-brand" style={{ animationDelay: '-14s' }} />
    </div>
  )
}
