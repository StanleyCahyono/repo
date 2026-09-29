/**
 * Existence check for /trips/[id], placed above the route's loading boundary: an unknown id calls notFound()
 * before anything streams, so the response carries a real 404 status (the page repeats the check).
 * The trips list keeps its own loading state inside the (list) route group so it never wraps this segment.
 */
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getCtx } from '@/lib/context'
import { getTripName } from '@/lib/data/trips'

const ID = /^[A-Za-z0-9_-]{1,100}$/

export default async function TripLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ID.test(id)) notFound()
  const ctx = await getCtx()
  if (!(await getTripName(ctx, id))) notFound()
  return children
}
