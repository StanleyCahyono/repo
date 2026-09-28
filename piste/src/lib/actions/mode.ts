'use server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { MODE_COOKIE } from '@/lib/context'
import { getDb } from '@/lib/db/client'
import { ensureDemoSeeded } from '@/lib/demo/ensure'

/** Switch between live data and the isolated demonstration database. */
export async function setMode(mode: 'live' | 'demo', returnTo = '/') {
  const store = await cookies()
  if (mode === 'demo') {
    await ensureDemoSeeded(await getDb('demo'))
    store.set(MODE_COOKIE, 'demo', { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
  } else {
    store.delete(MODE_COOKIE)
  }
  redirect(returnTo.startsWith('/') ? returnTo : '/')
}
