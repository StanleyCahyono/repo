'use client'
/**
 * "My rating" — my own 1–5 review after a visit, with notes. Saved through a zod-validated server action; the saved
 * state shows immediately and a toast offers Undo. Never mixed with the conditions score or "Fit for me".
 */
import { useId, useState, useTransition } from 'react'
import { motion } from 'motion/react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/ui/cn'
import { t } from '@/lib/ui/motion'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/form'
import { useToast } from '@/components/ui/toast'
import { saveMyRating } from '@/lib/actions/resort'

interface Saved {
  rating: number | null
  review: string | null
  updatedAt: string | null
}

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

export function RatingEditor({ resortId, name, initial, updatedLabel }: { resortId: string; name: string; initial: Saved | null; updatedLabel: string | null }) {
  const toast = useToast()
  const group = useId()
  const notesId = useId()
  const [saved, setSaved] = useState<Saved | null>(initial)
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null)
  const [hover, setHover] = useState<number | null>(null)
  const [review, setReview] = useState(initial?.review ?? '')
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [savedInSession, setSavedInSession] = useState(false)
  const [pending, start] = useTransition()

  const cleanReview = review.trim() ? review.trim() : null
  const dirty = rating !== (saved?.rating ?? null) || cleanReview !== (saved?.review ?? null)
  const shown = hover ?? rating ?? 0

  const persist = (next: { rating: number | null; review: string | null }, prev: Saved | null, announce: boolean) =>
    start(async () => {
      setError(null)
      const r = await saveMyRating({ resortId, rating: next.rating, review: next.review })
      if (!r.ok) {
        setError(r.fieldErrors?.rating ?? r.fieldErrors?.review ?? r.error)
        return
      }
      const now: Saved | null = r.data.updatedAt ? r.data : null
      setSaved(now)
      setRating(now?.rating ?? null)
      setReview(now?.review ?? '')
      setJustSaved(true)
      setSavedInSession(true)
      window.setTimeout(() => setJustSaved(false), 2400)
      if (announce) {
        toast.show(now ? `Your rating for ${name} is saved` : `Your rating for ${name} is cleared`, {
          undo: () => persist({ rating: prev?.rating ?? null, review: prev?.review ?? null }, now, false),
        })
      }
    })

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (dirty) persist({ rating, review: cleanReview }, saved, true)
      }}
    >
      <fieldset className="min-w-0">
        <legend className="sr-only">My rating for {name}, 1 to 5 stars</legend>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="-ml-1.5 flex" onMouseLeave={() => setHover(null)}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = n <= shown
              return (
                <label
                  key={n}
                  onMouseEnter={() => setHover(n)}
                  className="group relative inline-flex size-11 cursor-pointer items-center justify-center rounded-md has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-4px] has-[:focus-visible]:outline-focus md:size-9"
                >
                  <input
                    type="radio"
                    name={group}
                    value={n}
                    checked={rating === n}
                    onChange={() => setRating(n)}
                    className="sr-only"
                    aria-label={`${n} star${n === 1 ? '' : 's'} — ${WORDS[n]}`}
                  />
                  <motion.span
                    key={`${n}-${rating === n}`}
                    initial={rating === n ? { scale: 0.75 } : false}
                    animate={{ scale: 1 }}
                    transition={t.favorite}
                    className="inline-flex"
                  >
                    <Star
                      aria-hidden
                      className={cn('size-[22px] transition-colors duration-150', on ? 'text-copper' : 'text-divider-strong group-hover:text-ink-3')}
                      fill={on ? 'currentColor' : 'none'}
                      strokeWidth={1.8}
                    />
                  </motion.span>
                </label>
              )
            })}
          </div>
          <p className="min-w-0 text-[13.5px] text-ink-2 tnum" aria-live="polite">
            {shown ? (
              <>
                <span className="font-semibold text-ink">{shown}/5</span> · {WORDS[shown]}
              </>
            ) : (
              <span className="text-ink-3 italic">Not rated yet</span>
            )}
          </p>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={notesId} className="text-[13px] font-medium text-ink-2">
          Notes <span className="font-normal text-ink-3">(optional — surface, crowds, learning progress)</span>
        </label>
        <Textarea
          id={notesId}
          value={review}
          onChange={(e) => setReview(e.target.value)}
          maxLength={2000}
          rows={3}
          className="min-h-20 text-[14.5px]"
          placeholder={`What was ${name} like for you?`}
        />
      </div>
      {error ? (
        <p role="alert" className="text-[13px] font-medium text-critical">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!dirty || pending} className="h-10 md:h-8">
          {pending ? 'Saving…' : 'Save rating'}
        </Button>
        {saved ? (
          <Button type="button" variant="ghost" size="sm" disabled={pending} className="h-10 md:h-8" onClick={() => persist({ rating: null, review: null }, saved, true)}>
            Clear
          </Button>
        ) : null}
        <span className="text-[12.5px] text-ink-3 tnum" aria-live="polite">
          {justSaved || (savedInSession && saved && !dirty) ? 'Saved' : dirty ? 'Unsaved changes' : saved && updatedLabel ? `Saved ${updatedLabel}` : null}
        </span>
      </div>
    </form>
  )
}
