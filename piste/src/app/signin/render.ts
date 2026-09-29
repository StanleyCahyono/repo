/**
 * The sign-in page as one self-contained HTML document (no JavaScript, no app stylesheet, no app shell).
 *
 * Why not a React page: every App Router page renders inside the root layout, and the root layout reads your
 * preferences (home name, alert count) to draw the navigation. Before sign-in nothing personal may be sent, so
 * /signin is a Route Handler that returns this document instead. It uses the same design tokens (mirrored below from
 * src/app/globals.css), the same self-hosted fonts (served by /signin/fonts/*) and the same decorative contour art.
 */
import { topoRings } from '@/components/ui/topo'
import { MIN_SECRET_LENGTH, misconfigurationText, SESSION_TTL_SECONDS } from '@/lib/auth'

export type SignInView =
  | { kind: 'form'; next: string; notice: 'invalid' | 'locked' | 'signed-out' | 'origin' | 'bad-request' | null; retryAfterSec?: number | null }
  | { kind: 'off'; next: string }
  | { kind: 'misconfigured'; problem: 'secret-missing' | 'secret-short' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// Lucide icons (ISC), inlined as static SVG.
const ICON = {
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
}
const icon = (name: keyof typeof ICON, cls = 'icon') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name]}</svg>`

const FONT_FACES = [
  ['Barlow Condensed', 'barlow-condensed-latin-600-normal.woff2', 600],
  ['IBM Plex Sans', 'ibm-plex-sans-latin-400-normal.woff2', 400],
  ['IBM Plex Sans', 'ibm-plex-sans-latin-500-normal.woff2', 500],
  ['IBM Plex Sans', 'ibm-plex-sans-latin-600-normal.woff2', 600],
  ['IBM Plex Mono', 'ibm-plex-mono-latin-400-normal.woff2', 400],
] as const

export const SIGNIN_FONT_FILES: readonly string[] = FONT_FACES.map((f) => f[1])

const CSS = `
${FONT_FACES.map(([family, file, weight]) => `@font-face{font-family:'${family}';src:url(/signin/fonts/${file}) format('woff2');font-weight:${weight};font-style:normal;font-display:swap}`).join('\n')}
/* Design tokens — mirrored from src/app/globals.css (light, then dark). */
:root{--canvas:#f4f5f1;--surface:#fff;--surface-2:#f9faf7;--surface-3:#eceee8;--ink:#142938;--ink-2:#52616b;--ink-3:#5f6d76;--teal:#245d65;--teal-strong:#1b4a51;--on-teal:#fff;--glacier:#dcebea;--divider:#d7dfdf;--divider-strong:#b9c6c7;--critical:#a13f42;--critical-bg:#f6e2e2;--caution:#8c620e;--caution-bg:#f5ecd5;--info:#2c5c86;--info-bg:#e1eaf3;--focus:#245d65;--topo-line:rgb(36 93 101/.16);--topo-line-strong:rgb(36 93 101/.32);--shadow-lift:0 6px 18px -8px rgb(12 30 42/.22);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--canvas:#0c1a24;--surface:#12232e;--surface-2:#162a37;--surface-3:#1d3342;--ink:#e5ecee;--ink-2:#a8b7be;--ink-3:#97a7af;--teal:#6db3ba;--teal-strong:#8cc7cc;--on-teal:#0b1e25;--glacier:#1b3a41;--divider:#243a47;--divider-strong:#34505f;--critical:#ec8d90;--critical-bg:#3d1e21;--caution:#ddb45a;--caution-bg:#3a2f14;--info:#8ab6e0;--info-bg:#1a3048;--focus:#8cc7cc;--topo-line:rgb(141 199 204/.12);--topo-line-strong:rgb(141 199 204/.26);--shadow-lift:0 6px 18px -8px rgb(0 0 0/.55);color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--canvas);color:var(--ink);font:400 15px/1.55 'IBM Plex Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:max(24px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom))}
.card{width:100%;max-width:420px;background:var(--surface);border:1px solid var(--divider);border-radius:14px;overflow:hidden;animation:rise .22s cubic-bezier(.22,.8,.26,1) both}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.card{animation:none}}
.band{position:relative;height:112px;background:linear-gradient(160deg,var(--glacier),var(--surface-2) 72%);border-bottom:1px solid var(--divider)}
.band svg.topo{position:absolute;inset:0;width:100%;height:100%}
.brand{position:absolute;left:24px;bottom:16px;display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink)}
.brand .mark{width:32px;height:32px}
.brand span{font:600 26px/1 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.01em}
.body{padding:24px 24px 28px}
.eyebrow{margin:0 0 6px;font-size:12px;line-height:1.3;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
h1{margin:0;font:600 34px/1.02 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.005em;text-wrap:balance}
.lead{margin:8px 0 0;color:var(--ink-2);font-size:15px;text-wrap:pretty}
.notice{display:flex;gap:10px;margin:18px 0 0;padding:12px 14px;border:1px solid;border-radius:10px;font-size:13.5px;line-height:1.45}
.notice .icon{flex:none;width:16px;height:16px;margin-top:2px}
.notice p{margin:0}.notice p+p{margin-top:4px;color:var(--ink-2)}
.notice strong{font-weight:600}
.n-critical{background:var(--critical-bg);border-color:color-mix(in srgb,var(--critical) 40%,transparent)}.n-critical .icon{color:var(--critical)}
.n-caution{background:var(--caution-bg);border-color:color-mix(in srgb,var(--caution) 40%,transparent)}.n-caution .icon{color:var(--caution)}
.n-info{background:var(--info-bg);border-color:color-mix(in srgb,var(--info) 30%,transparent)}.n-info .icon{color:var(--info)}
form{margin:22px 0 0;display:flex;flex-direction:column;gap:14px}
label{font-size:13.5px;font-weight:500}
.field{display:flex;flex-direction:column;gap:6px}
input[type=password]{width:100%;height:44px;padding:0 12px;border:1px solid var(--divider-strong);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:16px;transition:border-color .15s}
input[type=password]:hover{border-color:var(--ink-3)}
input[type=password]:focus{outline:none;border-color:var(--teal)}
input:disabled{background:var(--surface-3);color:var(--ink-3)}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
input[type=password]:focus-visible{outline-offset:1px;border-radius:10px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 18px;border-radius:10px;border:1px solid var(--teal);background:var(--teal);color:var(--on-teal);font:500 15px/1 'IBM Plex Sans',system-ui,sans-serif;text-decoration:none;cursor:pointer;transition:background-color .15s,border-color .15s,transform .15s}
.btn:hover{background:var(--teal-strong);border-color:var(--teal-strong)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn .icon{width:16px;height:16px}
.hint{margin:0;font-size:12.5px;color:var(--ink-3)}
.fine{margin:22px 0 0;padding-top:16px;border-top:1px solid var(--divider);font-size:12.5px;color:var(--ink-3)}
ol{margin:16px 0 0;padding:0;list-style:none;counter-reset:step;display:flex;flex-direction:column;gap:12px}
ol li{position:relative;padding-left:34px;font-size:14px;color:var(--ink)}
ol li::before{counter-increment:step;content:counter(step);position:absolute;left:0;top:0;width:24px;height:24px;border-radius:999px;background:var(--glacier);color:var(--teal);font:600 12.5px/24px 'IBM Plex Sans',system-ui,sans-serif;text-align:center}
code{font:400 13px/1.4 'IBM Plex Mono',ui-monospace,monospace;background:var(--surface-3);border-radius:6px;padding:1px 6px;overflow-wrap:anywhere;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.foot{margin:0;font-size:12px;color:var(--ink-3)}
code.nw{white-space:nowrap}
.actions{margin:20px 0 0;display:flex;flex-wrap:wrap;gap:10px}
`

function contourSvg(): string {
  const rings = topoRings('piste-signin', 400, 240, 0.9)
  const paths = rings
    .map((r) => `<path d="${r.d}" fill="none" stroke="var(${r.index ? '--topo-line-strong' : '--topo-line'})" stroke-width="${r.index ? 1.1 : 0.8}" vector-effect="non-scaling-stroke"/>`)
    .join('')
  return `<svg class="topo" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${paths}</svg>`
}

const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="var(--teal)"/><path d="M4 23.5 12.2 12l4.6 6 3.4-4.2L28 23.5" fill="none" stroke="var(--on-teal)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><path d="M12.2 12c1.6 3.2 1 6.4-1.6 11.5" fill="none" stroke="var(--on-teal)" stroke-width="1.4" stroke-dasharray="1.6 2.2" stroke-linecap="round" opacity=".85"/></svg>`

function notice(tone: 'critical' | 'caution' | 'info', iconName: keyof typeof ICON, lines: string[], alert = false): string {
  return `<div class="notice n-${tone}" role="${alert ? 'alert' : 'status'}">${icon(iconName)}<div>${lines.map((l) => `<p>${l}</p>`).join('')}</div></div>`
}

const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60))
const TTL_DAYS = Math.round(SESSION_TTL_SECONDS / 86400)

function formBody(v: Extract<SignInView, { kind: 'form' }>): { title: string; html: string } {
  const locked = v.notice === 'locked'
  const n =
    v.notice === 'invalid'
      ? notice('critical', 'alert', ['<strong>That passcode didn’t match.</strong>', 'Check it and try again. Five wrong tries in 15 minutes pause sign-in for this device.'], true)
      : v.notice === 'locked'
        ? notice('caution', 'lock', [`<strong>Too many attempts — sign-in is paused.</strong>`, `Try again in ${minutes(v.retryAfterSec ?? 900)} min.`], true)
        : v.notice === 'signed-out'
          ? notice('info', 'info', ['<strong>You’re signed out on this browser.</strong>'])
          : v.notice === 'origin'
            ? notice('critical', 'shield', ['<strong>Sign-in refused.</strong>', 'The form was sent from another site. Open this page directly and try again.'], true)
            : v.notice === 'bad-request'
              ? notice('critical', 'alert', ['<strong>That request could not be read.</strong>', 'Reload the page and enter the passcode again.'], true)
              : ''
  const html = `
<p class="eyebrow">Private planner</p>
<h1>Sign in</h1>
<p class="lead">This Piste is protected with a passcode.</p>
${n}
<form method="post" action="/signin" autocomplete="on">
  <input type="hidden" name="next" value="${esc(v.next)}">
  <div class="field">
    <label for="passcode">Passcode</label>
    <input id="passcode" name="passcode" type="password" autocomplete="current-password" required maxlength="1024" ${locked ? 'disabled' : 'autofocus'} aria-describedby="passcode-hint">
    <p id="passcode-hint" class="hint">The one set in <code>PISTE_PASSCODE</code> on the server.</p>
  </div>
  <button class="btn" type="submit"${locked ? ' disabled' : ''}>Sign in ${icon('arrow')}</button>
</form>
<p class="fine">You stay signed in on this browser for ${TTL_DAYS} days. Changing the passcode or the session secret signs every browser out.</p>`
  return { title: 'Sign in', html }
}

function offBody(v: Extract<SignInView, { kind: 'off' }>): { title: string; html: string } {
  return {
    title: 'Sign-in is off',
    html: `
<p class="eyebrow">Access</p>
<h1>Sign-in is off</h1>
<p class="lead">Piste is running without a passcode — fine on your own computer. Anyone who can reach this address can use it.</p>
${notice('info', 'shield', ['<strong>Before you expose Piste to a network</strong>', `Set <code>PISTE_PASSCODE</code> and a random <code>PISTE_SESSION_SECRET</code> (${MIN_SECRET_LENGTH}+ characters) in <code>.env.local</code>, then restart.`])}
<div class="actions"><a class="btn" href="${esc(v.next)}">Open Piste ${icon('arrow')}</a></div>`,
  }
}

function misconfiguredBody(v: Extract<SignInView, { kind: 'misconfigured' }>): { title: string; html: string } {
  return {
    title: 'Sign-in is misconfigured',
    html: `
<p class="eyebrow">Configuration error</p>
<h1>Sign-in needs a session secret</h1>
${notice('critical', 'alert', [`<strong>${esc(misconfigurationText(v.problem))}</strong>`, 'Piste refuses to run unprotected, so every page shows this message until it is fixed.'], true)}
<ol>
  <li>Generate a secret: <code class="nw">openssl rand -base64 32</code></li>
  <li>Add <code>PISTE_SESSION_SECRET=&lt;that value&gt;</code> to <code>.env.local</code>, next to <code>PISTE_PASSCODE</code>.</li>
  <li>Restart Piste (and the worker, if it runs).</li>
</ol>
<p class="fine">To run without sign-in on a private machine, remove <code>PISTE_PASSCODE</code> instead.</p>`,
  }
}

export function renderSignInPage(v: SignInView): string {
  const { title, html } = v.kind === 'form' ? formBody(v) : v.kind === 'off' ? offBody(v) : misconfiguredBody(v)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f5f1">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c1a24">
<title>${esc(title)} · Piste</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<main class="wrap">
  <div class="card">
    <div class="band">${contourSvg()}<div class="brand">${MARK}<span>Piste</span></div></div>
    <div class="body">${html}</div>
  </div>
  <p class="foot">Piste · personal ski planner</p>
</main>
</body>
</html>`
}

/** Headers for the sign-in document: never cached, never framed, no scripts at all. */
export const SIGNIN_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
}
