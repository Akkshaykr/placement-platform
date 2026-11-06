import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useToast } from '@/components/ui/Toast'
import { toAppError } from '@/features/assessment/errors'
import type { QuestionDetail } from '@/features/admin/adminSchemas'
import { approveTranslation, saveTranslation } from './api'
import { cn } from '@/lib/cn'

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', NEEDS_REVIEW: 'Needs review', APPROVED: 'Approved' }

/** Tamil translation of one question version. English stays the canonical text. */
export function TamilTranslationCard({ detail }: { detail: QuestionDetail }) {
  const qc = useQueryClient()
  const toast = useToast()
  const saved = detail.tamil
  const [stem, setStem] = useState(saved?.stem ?? '')
  const [subtopic, setSubtopic] = useState(saved?.subtopic ?? '')
  const [explanation, setExplanation] = useState(saved?.explanation ?? '')
  const [options, setOptions] = useState<string[]>(
    detail.options.map((_, i) => saved?.options[i] ?? ''),
  )
  const [banner, setBanner] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'question', detail.question_id] })
  const fail = (e: unknown) => setBanner(toAppError(e).message)
  const touch = () => setDirty(true)

  const save = useMutation({
    mutationFn: async () => {
      if (stem.trim().length < 5) throw new Error('Enter the Tamil question text (at least 5 characters).')
      if (options.some((o) => o.trim().length === 0)) throw new Error('Translate every option.')
      return saveTranslation(detail.question_version_id, {
        stem: stem.trim(),
        subtopic: subtopic.trim(),
        explanation: explanation.trim(),
        options: options.map((o) => o.trim()),
      })
    },
    onSuccess: () => {
      setBanner(null)
      setDirty(false)
      toast.success('Tamil draft saved. It needs approval before students can see it.')
      refresh()
    },
    onError: fail,
  })

  const approve = useMutation({
    mutationFn: (flag: boolean) => approveTranslation(detail.question_version_id, flag),
    onSuccess: (_, flag) => {
      setBanner(null)
      toast.success(flag ? 'Tamil translation approved.' : 'Sent back to review.')
      refresh()
    },
    onError: fail,
  })

  const status = saved?.status ?? null
  const tone = status === 'APPROVED' ? 'success' : 'warning'

  return (
    <Card className="space-y-4 p-5" aria-label="Tamil translation">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Tamil translation</h2>
        {status ? <Badge tone={tone}>{STATUS_LABEL[status] ?? status}</Badge> : <Badge>Not started</Badge>}
      </div>
      <p className="text-sm text-ink-muted">
        English stays the original. Students see Tamil only after you approve it. Saving an edit sends it back to review.
      </p>
      {banner ? <Alert tone="danger" title="Not saved">{banner}</Alert> : null}

      <div className="space-y-4">
        <label className="block space-y-1.5 text-sm">
          <span className="block font-medium">Question text (Tamil)</span>
          <textarea
            lang="ta"
            className="min-h-24 w-full rounded-control border border-line-strong bg-canvas p-3"
            value={stem}
            maxLength={4000}
            onChange={(e) => { setStem(e.target.value); touch() }}
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="block font-medium">Subtopic (Tamil, optional)</span>
          <input
            lang="ta"
            className="h-10 w-full rounded-control border border-line-strong bg-canvas px-3"
            value={subtopic}
            onChange={(e) => { setSubtopic(e.target.value); touch() }}
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Options (Tamil)</legend>
          {detail.options.map((o, i) => (
            <div key={o.id} className="space-y-1">
              <p className="text-xs text-ink-muted">
                {String.fromCharCode(65 + i)}. {o.body}
              </p>
              <input
                lang="ta"
                aria-label={`Option ${i + 1} in Tamil`}
                className={cn('h-10 w-full rounded-control border bg-canvas px-3', 'border-line-strong')}
                value={options[i] ?? ''}
                maxLength={1000}
                onChange={(e) => { setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x))); touch() }}
              />
            </div>
          ))}
        </fieldset>
        <label className="block space-y-1.5 text-sm">
          <span className="block font-medium">Explanation (Tamil)</span>
          <textarea
            lang="ta"
            className="min-h-20 w-full rounded-control border border-line-strong bg-canvas p-3"
            value={explanation}
            maxLength={8000}
            onChange={(e) => { setExplanation(e.target.value); touch() }}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-line pt-4">
        <Button loading={save.isPending} onClick={() => save.mutate()}>Save Tamil draft</Button>
        {status && status !== 'APPROVED' ? (
          <Button variant="secondary" disabled={dirty} loading={approve.isPending} onClick={() => approve.mutate(true)}>
            Approve Tamil
          </Button>
        ) : null}
        {status === 'APPROVED' ? (
          <Button variant="ghost" loading={approve.isPending} onClick={() => approve.mutate(false)}>
            Send back to review
          </Button>
        ) : null}
      </div>
      {dirty && status && status !== 'APPROVED' ? (
        <p className="text-xs text-ink-muted">Save your changes before approving.</p>
      ) : null}
    </Card>
  )
}