import { DEFAULT_LOCALE, messages, type Locale } from "@/lib/i18n"
import type { Column } from "@/lib/schema"

/** Identifier-like headers ("Sipariş No", "musteri_id", "Kod") make poor groupings. */
const ID_LIKE = /(^|[\s_])(no|id|kod|code|numara|number|nr)$/i
// Amounts first: "tutar" answers "how much did we sell", "birim_fiyat" does not.
const AMOUNT_LIKE = /tutar|ciro|gelir|satış|satis|amount|revenue|total|toplam/i
const PRICE_LIKE = /fiyat|price/i

/** Example questions derived from column headers only. */
export function suggestQuestions(columns: readonly Column[], locale: Locale = DEFAULT_LOCALE): string[] {
  const t = messages[locale].suggestions
  const texts = columns.filter((c) => c.type === "text")
  const numbers = columns.filter((c) => c.type === "number" && !ID_LIKE.test(c.name))
  const text = texts.find((c) => !ID_LIKE.test(c.name)) ?? texts[0]
  const num = numbers.find((c) => AMOUNT_LIKE.test(c.name)) ?? numbers.find((c) => PRICE_LIKE.test(c.name)) ?? numbers[0]
  const date = columns.find((c) => c.type === "date")
  const measure = num?.name ?? t.rowCount

  const out: string[] = []
  if (text) out.push(t.top(measure, text.name))
  if (date) out.push(t.trend(measure))
  if (text) out.push(t.share(text.name, measure))
  return out
}
