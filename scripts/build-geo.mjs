// Builds DISH's compact worldwide country & currency datasets.
// Usage: node scripts/build-geo.mjs   (dev-only sources, nothing added to the app bundle)
//
// Sources:
//   - world-countries (mledoze/countries): ISO 3166-1 alpha-2/alpha-3 codes, names,
//     flags and each country's currencies (plus Kosovo, XK, widely recognised).
//   - currency-codes: the ISO 4217 list (codes, minor units, names).
// Currency names come from the platform's Unicode CLDR data via Intl.DisplayNames.
import { writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const countries = require('world-countries')
const cc = require('currency-codes')

// ISO 4217 codes that are not everyday money (funds, metals, testing, accounting units)
const NOT_TENDER = new Set(['BOV', 'CHE', 'CHW', 'CLF', 'COU', 'MXV', 'USN', 'UYI', 'UYW', 'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XDR', 'XPD', 'XPT', 'XSU', 'XTS', 'XUA', 'XXX'])
const names = new Intl.DisplayNames(['en'], { type: 'currency' })
const symbol = (code) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code
  } catch {
    return code
  }
}

// Codes the platform (CLDR/ICU) also knows, used to admit new ISO codes the
// package hasn't caught up with yet (e.g. SLE) when a country lists them.
const platform = new Set(Intl.supportedValuesOf('currency'))
const listedByCountries = new Set(countries.flatMap((c) => Object.keys(c.currencies ?? {})))
const codes = [...new Set([...cc.codes(), ...[...listedByCountries].filter((k) => platform.has(k) && !cc.code(k))])]

// Documented defaults where the source has no currency or an unhelpful first entry.
const DEFAULT_OVERRIDES = { FM: ['USD'], SL: ['SLE', 'SLL'], ZW: ['USD', 'ZWG', 'ZAR', 'BWP', 'GBP', 'EUR', 'CNY', 'INR', 'JPY'] }

const currencies = codes
  .filter((c) => !NOT_TENDER.has(c))
  .map((code) => {
    const d = cc.code(code) ?? { currency: code, digits: 2 }
    let name = d.currency
    try {
      name = names.of(code) || name
    } catch {
      /* keep dataset name */
    }
    return { code, name: name.replace(/\s*—\s*/g, '–'), symbol: symbol(code), digits: d.digits ?? 2 }
  })
  .sort((a, b) => a.name.localeCompare(b.name))
const iso = new Set(currencies.map((c) => c.code))

const out = countries
  .map((c) => {
    const listed = DEFAULT_OVERRIDES[c.cca2] ?? Object.keys(c.currencies ?? {})
    const valid = listed.filter((k) => iso.has(k)) // never suggest a non-ISO local unit
    return { c2: c.cca2, c3: c.cca3, name: c.name.common, flag: c.flag, cur: valid }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

const dir = fileURLToPath(new URL('../src/data/geo/', import.meta.url))
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}countries.json`, JSON.stringify(out))
writeFileSync(`${dir}currencies.json`, JSON.stringify(currencies))
const missing = out.filter((c) => !c.cur.length).map((c) => c.c2)
console.log(`countries: ${out.length} · currencies: ${currencies.length} · without an ISO currency: ${missing.join(' ') || 'none'}`)
