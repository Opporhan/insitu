import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n"
import type { ResultValue, ValueFormat } from "@/lib/schema"

function makeFormatters(locale: Locale) {
  const tag = INTL_LOCALE[locale]
  // Amounts are Turkish lira in either language; "narrowSymbol" keeps "₺" instead of "TRY".
  const money = { style: "currency", currency: "TRY", currencyDisplay: "narrowSymbol" } as const
  return {
    currencyWhole: new Intl.NumberFormat(tag, { ...money, maximumFractionDigits: 0 }),
    currencyCents: new Intl.NumberFormat(tag, { ...money, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    currencyCompact: new Intl.NumberFormat(tag, { ...money, notation: "compact", maximumFractionDigits: 1 }),
    integer: new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }),
    decimal: new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }),
    compact: new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 }),
    percentFine: new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 2 }),
    percentCoarse: new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 1 }),
    day: new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
    monthLong: new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }),
    monthShort: new Intl.DateTimeFormat(tag, { month: "short", year: "2-digit", timeZone: "UTC" }),
  }
}

const FORMATTERS: Record<Locale, ReturnType<typeof makeFormatters>> = {
  tr: makeFormatters("tr"),
  en: makeFormatters("en"),
}

export const NUMERIC_FORMATS: ReadonlySet<ValueFormat> = new Set(["currency", "number", "integer", "percent"])

export function isNumericFormat(format: ValueFormat): boolean {
  return NUMERIC_FORMATS.has(format)
}

/** Formats a share given as a 0–1 ratio, e.g. 0.246 → "%24,6" / "24.6%". */
export function formatRatio(ratio: number, locale: Locale = DEFAULT_LOCALE): string {
  const f = FORMATTERS[locale]
  return (Math.abs(ratio) < 0.01 ? f.percentFine : f.percentCoarse).format(ratio)
}

/** Plain integer with the locale's grouping, e.g. row counts. */
export function formatCount(n: number, locale: Locale = DEFAULT_LOCALE): string {
  return FORMATTERS[locale].integer.format(n)
}

function formatNumber(n: number, format: ValueFormat, short: boolean, locale: Locale): string {
  const f = FORMATTERS[locale]
  switch (format) {
    case "currency": {
      if (short && Math.abs(n) >= 10_000) return f.currencyCompact.format(n)
      const cents = Math.round(n * 100) / 100
      return (Number.isInteger(cents) ? f.currencyWhole : f.currencyCents).format(cents)
    }
    case "integer":
      return short && Math.abs(n) >= 10_000 ? f.compact.format(n) : f.integer.format(n)
    case "percent":
      return formatRatio(n / 100, locale)
    default:
      return short && Math.abs(n) >= 10_000 ? f.compact.format(n) : f.decimal.format(n)
  }
}

function formatDateText(s: string, format: "date" | "month", short: boolean, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s)
  if (!m) return s
  const [, y, mo, d] = m
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, d === undefined ? 1 : Number(d)))
  if (Number.isNaN(date.getTime())) return s
  const f = FORMATTERS[locale]
  if (format === "month" || d === undefined) return (short ? f.monthShort : f.monthLong).format(date)
  return f.day.format(date)
}

/**
 * Formats a result cell for display. `short` gives compact output for axis ticks.
 * Values that do not match the declared format are shown as-is rather than guessed.
 */
export function formatValue(value: ResultValue, format: ValueFormat, short = false, locale: Locale = DEFAULT_LOCALE): string {
  if (value === null) return "—"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—"
    return isNumericFormat(format) ? formatNumber(value, format, short, locale) : formatNumber(value, "number", short, locale)
  }
  if (format === "date" || format === "month") return formatDateText(value, format, short, locale)
  return value
}
