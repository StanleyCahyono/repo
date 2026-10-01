/**
 * Existence check for /resorts/[id], placed above the route's loading boundary: an unknown id calls notFound()
 * before anything streams, so the response carries a real 404 status (the page repeats the check).
 */
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getCtx } from '@/lib/context'
import { getResortName } from '@/lib/data/resort-page'

const ID = /^[a-z0-9-]{1,100}$/

export default async function ResortLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ID.test(id)) notFound()
  const ctx = await getCtx()
  if (!(await getResortName(ctx, id))) notFound()
  return children
}
