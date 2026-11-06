import { useMemo } from 'react'
import { COUNTRIES, CURRENCIES, countryByCode, countryCurrencies, currencyByCode, guessCountry, searchCountries, searchCurrencies, suggestedCurrency } from '@/lib/geo'
import { SearchSelect, type SearchOption } from '@/components/ui/SearchSelect'
import { cn } from '@/lib/cn'

export interface CountryCurrencyValue {
  country_code: string | null
  currency: string
  currency_source: 'suggested' | 'manual' | null
}

const countryOption = (c: (typeof COUNTRIES)[number]): SearchOption => ({ value: c.c2, label: c.name, lead: c.flag, hint: c.c2 })
const currencyOption = (c: (typeof CURRENCIES)[number]): SearchOption => ({ value: c.code, label: c.name, hint: `${c.code}${c.symbol !== c.code ? ` · ${c.symbol}` : ''}` })
const COUNTRY_OPTIONS = COUNTRIES.map(countryOption)
const CURRENCY_OPTIONS = CURRENCIES.map(currencyOption)

/**
 * Country and currency are separate fields. Choosing a country *suggests* its
 * currency (from the dataset, not UI rules); a currency the user picked by hand
 * is never overwritten — they get a one-tap suggestion instead.
 */
export function CountryCurrencyFields({ value, onChange }: { value: CountryCurrencyValue; onChange: (v: CountryCurrencyValue) => void }) {
  const country = countryByCode(value.country_code)
  const local = countryCurrencies(value.country_code)
  const suggestion = value.country_code ? suggestedCurrency(value.country_code) : null
  const guessed = useMemo(() => guessCountry(), [])

  const setCountry = (c2: string) => {
    const next = suggestedCurrency(c2)
    if (value.currency_source === 'manual') onChange({ ...value, country_code: c2 })
    else onChange({ country_code: c2, currency: next, currency_source: 'suggested' })
  }

  const pinnedCountry = guessed && guessed !== value.country_code ? { title: 'Suggested', options: [countryOption(countryByCode(guessed)!)] } : undefined
  const pinnedCurrency = local.length ? { title: country ? `Used in ${country.name}` : 'Suggested', options: local.map(currencyOption) } : undefined
  const cur = currencyByCode(value.currency)

  return (
    <div className="flex flex-col gap-5">
      <SearchSelect label="Country" value={value.country_code} options={COUNTRY_OPTIONS} search={(q) => searchCountries(q).map(countryOption)} onChange={setCountry} placeholder="Choose your country" searchPlaceholder="Search countries" pinned={pinnedCountry} hint="Sets sensible defaults. It doesn't limit the food you'll see." />
      <div>
        <SearchSelect
          label="Currency"
          value={value.currency}
          options={CURRENCY_OPTIONS}
          search={(q) => searchCurrencies(q).map(currencyOption)}
          onChange={(code) => onChange({ ...value, currency: code, currency_source: code === suggestion ? 'suggested' : 'manual' })}
          placeholder="Choose a currency"
          searchPlaceholder="Search currencies or codes"
          pinned={pinnedCurrency}
          hint={cur ? `Prices and budgets show in ${cur.name} (${cur.code}).` : undefined}
        />
        {local.length > 1 && (
          <div role="group" aria-label={`Currencies used in ${country?.name}`} className="mt-3 flex flex-wrap gap-2">
            {local.map((c) => (
              <button key={c.code} type="button" aria-pressed={value.currency === c.code} onClick={() => onChange({ ...value, currency: c.code, currency_source: c.code === suggestion ? 'suggested' : 'manual' })} className={cn('press h-9 rounded-full px-3.5 text-sm font-semibold ring-1 ring-inset transition-colors', value.currency === c.code ? 'bg-accent-soft text-ink ring-accent-border' : 'bg-elevated text-ink ring-line')}>
                {c.code}
              </button>
            ))}
          </div>
        )}
        {value.currency_source === 'manual' && suggestion && suggestion !== value.currency && (
          <button type="button" className="mt-3 text-sm font-semibold text-ink underline underline-offset-2" onClick={() => onChange({ ...value, currency: suggestion, currency_source: 'suggested' })}>
            Use {currencyByCode(suggestion)?.name ?? suggestion} ({suggestion}) for {country?.name}
          </button>
        )}
      </div>
    </div>
  )
}
