'use client'
/**
 * The Passes & Costs headline: one plain question per section (huge, light, tight tracking — the Glass HUD title).
 * It re-enters with the same CSS rise when the section changes.
 */
import { usePathname } from 'next/navigation'
import css from './hud.module.css'

const TITLES: [prefix: string, title: string, eyebrow: string][] = [
  ['/passes/products', 'Every pass, every price', 'Products & prices'],
  ['/passes/matrix', 'Who covers what', 'Access matrix'],
  ['/passes/costs', 'What a ski day costs', 'Day costs'],
  ['/passes/compare', 'Pass or lift tickets?', 'Pass vs tickets'],
  ['/passes/rules', 'Enter the rule', 'Rule editor'],
]

export function passesTitle(pathname: string): { title: string; eyebrow: string } {
  const hit = TITLES.find(([p]) => pathname.startsWith(p))
  return hit ? { title: hit[1], eyebrow: hit[2] } : { title: 'Can I use my pass there?', eyebrow: 'Pass checker' }
}

export function PassesTitle() {
  const { title } = passesTitle(usePathname())
  return (
    <h1 key={title} className={`${css.rise} m-0 text-[clamp(40px,5vw,72px)] leading-[1] font-light tracking-[-0.04em] text-ink`}>
      {title}
    </h1>
  )
}
