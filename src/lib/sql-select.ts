import type { ValueFormat } from "@/lib/schema"

/**
 * Reads the output list of a SELECT ("SUM("tutar") AS ciro, "sehir"") so a hand-edited query
 * can inherit formats: an alias computed from a money column is money, a COUNT is a whole
 * number. Only used for display formats — never to change what the query computes.
 */

export type SelectItem = { expr: string; alias: string; sources: string[] }

/** Outermost SELECT list (the last top-level SELECT, so CTEs are skipped), split on top-level commas. */
export function selectItems(sql: string): SelectItem[] {
  let depth = 0
  let quote: string | null = null
  let selectAt = -1
  let fromAt = -1
  const commas: number[] = []
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? ""
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === "(") depth++
    else if (c === ")") depth--
    else if (depth === 0) {
      const word = /^[a-z]+/i.exec(sql.slice(i, i + 7))?.[0]?.toLowerCase()
      const boundary = !/[\w$]/.test(sql[i - 1] ?? "")
      if (boundary && word === "select") {
        selectAt = i + 6
        fromAt = -1
        commas.length = 0
      } else if (boundary && word === "from" && selectAt >= 0 && fromAt < 0) fromAt = i
      else if (c === "," && selectAt >= 0 && fromAt < 0) commas.push(i)
    }
  }
  if (selectAt < 0) return []
  const end = fromAt < 0 ? sql.length : fromAt
  const bounds = [selectAt, ...commas.map((c) => c + 1), end + 1]
  return bounds.slice(0, -1).flatMap((start, k) => {
    const raw = sql.slice(start, (bounds[k + 1] ?? end + 1) - 1).trim().replace(/^distinct\s+/i, "")
    if (!raw) return []
    // "expr AS name", or "expr name" without AS (not when the last word is SQL, like CASE … END).
    const implicit = /\s+("(?:[^"]|"")+"|[a-z_][\w$]*)\s*$/i.exec(raw)
    const keyword = /^(end|null|true|false|distinct|and|or|not|else|then)$/i.test(implicit?.[1] ?? "")
    // "a" + "b" has no name: the word before the space must end an expression, not be an operator.
    const ended = implicit !== null && /[)"\w]/.test(raw.slice(0, implicit.index).trimEnd().slice(-1))
    const as = /\s+as\s+("(?:[^"]|"")+"|[\w$]+)\s*$/i.exec(raw) ?? (implicit && !keyword && ended ? implicit : null)
    const bare = /^("(?:[^"]|"")+"|[\w$]+)$/.exec(raw)
    const unquote = (s: string) => (s.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s)
    const alias = as ? unquote(as[1] ?? "") : bare ? unquote(bare[1] ?? "") : raw
    const expr = as ? raw.slice(0, as.index) : raw
    const sources = [...expr.matchAll(/"((?:[^"]|"")+)"/g)].map((m) => (m[1] ?? "").replace(/""/g, '"'))
    return [{ expr, alias, sources: [...new Set(sources)] }]
  })
}

/** Clearly money by name; words like "adet" (quantity) or "sayı" (count) are never money. */
const MONEY_NAME = /(tutar|ciro|fiyat|gelir|maliyet|gider|bakiye|borc|alacak|price|revenue|amount|cost|income|balance)/
const NOT_MONEY = /(adet|miktar|sayi|sayisi|count|qty|quantity|oran|yuzde|percent|rate)/

/** A column whose name clearly means money ("tutar", "birim_fiyat", "ciro"), never a quantity. */
export function isMoneyName(name: string): boolean {
  const n = name.toLowerCase()
  return MONEY_NAME.test(n) && !NOT_MONEY.test(n)
}

const AGG = /^\s*(sum|avg|mean|min|max|median|count)\s*\(/i

/** Display format for an output column of a hand-edited query, or null when nothing is known. */
export function inferFormat(item: SelectItem, known: ReadonlyMap<string, ValueFormat>): { format: ValueFormat; total: boolean } | null {
  const fn = AGG.exec(item.expr)?.[1]?.toLowerCase()
  if (fn === "count") return { format: "integer", total: true }
  const summable = fn === undefined || fn === "sum"
  if (item.sources.length !== 1) return null
  const source = item.sources[0] ?? ""
  const knownFormat = known.get(source)
  if (knownFormat) {
    // An average of whole numbers is not a whole number.
    const format = knownFormat === "integer" && fn === "avg" ? "number" : knownFormat
    return { format, total: summable && format !== "percent" }
  }
  if (isMoneyName(source)) return { format: "currency", total: summable }
  return null
}

/** Source column → format, learned from an earlier plan ("SUM("tutar") AS toplam_ciro" was currency). */
export function knownFormats(sql: string, columns: readonly { key: string; format: ValueFormat }[]): Map<string, ValueFormat> {
  const out = new Map<string, ValueFormat>()
  const byKey = new Map(columns.map((c) => [c.key, c.format]))
  for (const item of selectItems(sql)) {
    const format = byKey.get(item.alias)
    if (!format || format === "text" || /^\s*count\s*\(/i.test(item.expr) || item.sources.length !== 1) continue
    out.set(item.sources[0] ?? "", format)
  }
  return out
}
