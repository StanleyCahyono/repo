'use client'
/**
 * The Passes & Costs headline: one plain question per section (huge, light, tight tracking — the Glass HUD title) and
 * one short, friendly line under it. Both re-enter with the same CSS rise when the section changes.
 */
import type { CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import css from './hud.module.css'

const TITLES: [prefix: string, title: string, eyebrow: string, lead: string][] = [
  ['/passes/products', 'Every pass, every price', 'Products & prices', 'Each pass with its published prices, when sales close and when prices go up.'],
  ['/passes/costs', 'What a ski day costs', 'Day costs', 'Lift ticket, rental, lunch and parking at every resort, for the day you pick.'],
  ['/passes/compare', 'Pass or lift tickets?', 'Pass vs tickets', 'Add the days you plan to ski and see which costs less.'],
  ['/passes/rules', 'Enter the rule', 'Rule editor', 'Copy a pass rule from its official page — it’s saved as a new version.'],
]

export function passesTitle(pathname: string): { title: string; eyebrow: string; lead: string } {
  const hit = TITLES.find(([p]) => pathname.startsWith(p))
  return hit
    ? { title: hit[1], eyebrow: hit[2], lead: hit[3] }
    : { title: 'Can I use my pass there?', eyebrow: 'Pass checker', lead: 'Pick a pass, a resort and your dates — and keep track of the days you’ve used.' }
}

export function PassesTitle() {
  const { title, lead } = passesTitle(usePathname())
  return (
    <>
      <h1 key={title} className={`${css.rise} m-0 text-[clamp(38px,5vw,72px)] leading-[1.02] font-light tracking-[-0.04em] text-balance text-ink`}>
        {title}
      </h1>
      <p key={lead} style={{ '--i': 1 } as CSSProperties} className={`${css.rise} m-0 max-w-[60ch] text-[15px] leading-[1.5] text-ink-2 md:text-[16px]`}>
        {lead}
      </p>
    </>
  )
}
