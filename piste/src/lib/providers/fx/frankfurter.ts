/**
 * Frankfurter (https://www.frankfurter.app/docs/) — ECB euro foreign-exchange reference rates, no key.
 * GET https://api.frankfurter.app/latest?from=USD&to=CAD,EUR → { amount, base, date, rates: { CAD: 1.37, … } }
 *
 * The ECB publishes one reference rate per TARGET business day (~16:00 CET); `date` is that reference date, so
 * weekends/holidays return the previous business day. Rates are informational, not transaction rates. JSON
 * numbers are converted to plain decimal strings with big.js (no float arithmetic downstream).
 */
import Big from 'big.js'
import { z } from 'zod'
import { provenance } from '@/lib/domain/types'
import { defaultHttp, type HttpClient } from '../http'
import { addHoursIso, caps, describeIssues, fail, failFromHttp } from '../result'
import type { FxProvider, FxQuote, ProviderResult } from '../types'

export const FRANKFURTER_URL = 'https://api.frankfurter.app/latest'
const CODE = /^[A-Z]{3}$/

const Schema = z.object({
  // Rates are divided by `amount`: zero or negative is a malformed response ('parse'), never a thrown division.
  amount: z.number().positive().optional(),
  base: z.string().regex(CODE),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.record(z.string(), z.number().positive()),
})

/** JSON number → plain decimal string ("0.9132", never "9.132e-1"). */
export function decimalString(n: number): string {
  return new Big(String(n)).toFixed()
}

export function createFrankfurterProvider(options: { http?: HttpClient } = {}): FxProvider {
  return {
    id: 'frankfurter',
    async fetchRates(base, quotes): Promise<ProviderResult<FxQuote[]>> {
      const from = base.trim().toUpperCase()
      const to = [...new Set(quotes.map((q) => q.trim().toUpperCase()))].filter((q) => q !== from)
      if (!CODE.test(from) || to.some((q) => !CODE.test(q))) return fail('unsupported', 'Currency codes must be ISO 4217 (three letters)')
      if (to.length === 0) return fail('unsupported', 'No quote currencies requested')
      const url = `${FRANKFURTER_URL}?from=${from}&to=${to.join(',')}`
      const res = await (options.http ?? defaultHttp).request(url, { expect: 'json', headers: { Accept: 'application/json' }, timeoutMs: 10_000, retries: 2, cacheTtlMs: 60 * 60_000 })
      if (!res.ok) {
        // Frankfurter answers 404 for currencies it does not publish.
        if (res.status === 404 || res.status === 422) return failFromHttp({ ...res, errorKind: 'unsupported' }, [res.fetch], 'Frankfurter')
        return failFromHttp(res, [res.fetch], 'Frankfurter')
      }
      const parsed = Schema.safeParse(res.data)
      if (!parsed.success) return fail('parse', `Frankfurter: ${describeIssues(parsed.error.issues)}`, [{ ...res.fetch, ok: false }], false)
      const d = parsed.data
      if (d.base !== from) return fail('parse', `Frankfurter returned base ${d.base}, expected ${from}`, [{ ...res.fetch, ok: false }], false)
      const amount = d.amount ?? 1
      const data: FxQuote[] = to
        .filter((q) => d.rates[q] !== undefined)
        .map((q) => ({ base: from, quote: q, rate: new Big(String(d.rates[q])).div(new Big(String(amount))).toFixed(), rateDate: d.date }))
      const missing = to.filter((q) => d.rates[q] === undefined)
      return {
        ok: true,
        data,
        capabilities: caps(
          data.map((q) => `${from}/${q.quote}`),
          missing.map((q) => `${from}/${q}`),
          ['ECB reference rates (one per business day); informational, not the rate a card or bank will charge.'],
        ),
        fetches: [{ ...res.fetch, extract: { date: d.date, rates: Object.fromEntries(data.map((q) => [q.quote, q.rate])) } }],
        provenance: provenance({
          kind: 'official',
          provider: 'Frankfurter (ECB reference rates)',
          sourceUrl: url,
          publishedAt: null,
          fetchedAt: res.fetch.fetchedAt,
          validFrom: d.date,
          staleAfter: addHoursIso(res.fetch.fetchedAt, 36),
          verification: 'api',
          note: `ECB reference date ${d.date}`,
        }),
      }
    },
  }
}

export const frankfurterProvider: FxProvider = createFrankfurterProvider()
