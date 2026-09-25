import type { Column, OutputColumn, QueryPlan, TranslateRequest, TranslateResponse, ValueFormat } from "@/lib/schema"
import { quoteIdent } from "@/lib/sql"
import { suggestQuestions } from "@/lib/suggestions"
import type { QueryTranslator } from "./types"

/**
 * Rule-based stand-in for an AI translator. Like a real provider it only sees
 * the question and column headers, and emits DuckDB SQL over table `data`
 * returning `label` and `value`.
 */

const MONEY_WORDS = ["kazan", "gelir", "ciro", "hasilat", "satis", "revenue", "sales", "tutar", "para"]
const REVENUE_COLS = ["tutar", "gelir", "ciro", "hasilat", "revenue", "sales", "amount", "total", "toplam", "satis"]
const PRICE_COLS = ["fiyat", "price", "ucret"]
const QTY_COLS = ["adet", "miktar", "quantity", "qty", "units"]
const QTY_WORDS = ["adet", "miktar", "tane", "quantity", "units"]
const TREND_WORDS = ["trend", "zaman", "aylik", "haftalik", "gunluk", "yillik", "seyir", "degisim", "monthly", "weekly", "daily", "yearly", "over"]
const SHARE_WORDS = ["dagilim", "pay", "oran", "yuzde", "share", "breakdown", "percent"]
const AVG_WORDS = ["ortalama", "average", "avg", "mean"]
const COUNT_WORDS = ["kac", "sayisi", "count", "how"]
const ASC_PHRASES = ["en az", "en dusuk", "lowest", "least"]
const NUMBER_WORDS: Record<string, number> = {
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}

const DEFAULT_TOP_N = 10

/** Lowercase and fold Turkish characters so "Ürün" and "urun" match. */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
}

function tokens(s: string): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter(Boolean)
}

/** Question tokens carry Turkish suffixes ("ürünü"), so match by prefix. */
function hasWord(qTokens: readonly string[], words: readonly string[]): boolean {
  return qTokens.some((t) => words.some((w) => t.startsWith(w)))
}

function isMentioned(column: Column, qTokens: readonly string[]): boolean {
  return tokens(column.name)
    .filter((ct) => ct.length >= 3)
    .some((ct) => qTokens.some((qt) => qt.startsWith(ct)))
}

function nameMatches(column: Column, words: readonly string[]): boolean {
  return tokens(column.name).some((ct) => words.some((w) => ct.startsWith(w)))
}

type Intent = "top" | "trend" | "share"
type Measure = { expr: string; name: string; format: ValueFormat; additive: boolean }

function pickMeasure(columns: readonly Column[], qTokens: readonly string[]): Measure {
  const numeric = columns.filter((c) => c.type === "number")
  const agg = hasWord(qTokens, AVG_WORDS) ? "AVG" : "SUM"
  const aggName = agg === "AVG" ? "ortalama" : "toplam"
  const formatOf = (c: Column): ValueFormat =>
    nameMatches(c, [...REVENUE_COLS, ...PRICE_COLS]) ? "currency" : agg === "SUM" && nameMatches(c, QTY_COLS) ? "integer" : "number"
  const of = (c: Column): Measure => ({
    expr: `${agg}(${quoteIdent(c.name)})`,
    name: `${aggName} ${c.name}`,
    format: formatOf(c),
    additive: agg === "SUM",
  })

  const mentioned = numeric.find((c) => isMentioned(c, qTokens))
  if (mentioned) return of(mentioned)

  const count: Measure = { expr: "COUNT(*)", name: "kayıt sayısı", format: "integer", additive: true }
  if (hasWord(qTokens, COUNT_WORDS) || numeric.length === 0) return count

  if (hasWord(qTokens, QTY_WORDS)) {
    const qty = numeric.find((c) => nameMatches(c, QTY_COLS))
    if (qty) return of(qty)
  }

  if (hasWord(qTokens, MONEY_WORDS)) {
    const revenue = numeric.find((c) => nameMatches(c, REVENUE_COLS))
    if (revenue) return of(revenue)
    const price = numeric.find((c) => nameMatches(c, PRICE_COLS))
    const qty = numeric.find((c) => nameMatches(c, QTY_COLS))
    if (price && qty) {
      return {
        expr: `${agg}(${quoteIdent(price.name)} * ${quoteIdent(qty.name)})`,
        name: `${aggName} ${price.name} × ${qty.name}`,
        format: "currency",
        additive: agg === "SUM",
      }
    }
    if (price) return of(price)
  }

  // numeric.length > 0 was checked above
  return of(numeric[0] as Column)
}

function pickTopN(qTokens: readonly string[]): number {
  for (let i = 0; i < qTokens.length; i++) {
    const t = qTokens[i] as string
    const prev = qTokens[i - 1]
    const n = /^\d+$/.test(t) ? Number(t) : prev === "ilk" || prev === "top" ? NUMBER_WORDS[t] : undefined
    if (n !== undefined && n >= 1 && n <= 50) return n
  }
  return DEFAULT_TOP_N
}

function pickGrain(qTokens: readonly string[]): { unit: string; pattern: string; format: ValueFormat } {
  if (hasWord(qTokens, ["gunluk", "daily"])) return { unit: "day", pattern: "%Y-%m-%d", format: "date" }
  if (hasWord(qTokens, ["haftalik", "weekly"])) return { unit: "week", pattern: "%Y-%m-%d", format: "date" }
  if (hasWord(qTokens, ["yillik", "yearly"])) return { unit: "year", pattern: "%Y", format: "text" }
  return { unit: "month", pattern: "%Y-%m", format: "month" }
}

function xyPlan(chartType: QueryPlan["chartType"], x: OutputColumn, measure: Measure, sql: string): QueryPlan {
  return {
    sql,
    chartType,
    xAxisKey: "label",
    yAxisKey: "value",
    seriesKey: "",
    title: `${x.label} bazında ${measure.name}`,
    columns: [x, { key: "value", label: measure.name, format: measure.format, total: measure.additive }],
  }
}

function periodFilter(folded: string, date: Column | undefined): string | null {
  if (!date) return null
  const d = quoteIdent(date.name)
  const unit = /\bbu ay\b|this month/.test(folded) ? "month" : /\bbu yil\b|this year/.test(folded) ? "year" : null
  if (!unit) return null
  // "This month" means the latest month present in the data, not the wall clock.
  return `date_trunc('${unit}', ${d}) = (SELECT max(date_trunc('${unit}', ${d})) FROM data)`
}

function where(conditions: readonly (string | null)[]): string {
  const c = conditions.filter((x): x is string => x !== null)
  return c.length > 0 ? `WHERE ${c.join(" AND ")}` : ""
}

function fail(columns: readonly Column[], error: string): TranslateResponse {
  return { ok: false, error, suggestions: suggestQuestions(columns) }
}

export function planQuery({ question, columns }: TranslateRequest): TranslateResponse {
  const folded = fold(question)
  const qTokens = tokens(question)

  const texts = columns.filter((c) => c.type === "text")
  const dates = columns.filter((c) => c.type === "date")
  const dim = texts.find((c) => isMentioned(c, qTokens)) ?? texts[0]
  const date = dates.find((c) => isMentioned(c, qTokens)) ?? dates[0]

  let intent: Intent = "top"
  if (date && (hasWord(qTokens, TREND_WORDS) || !dim)) intent = "trend"
  else if (hasWord(qTokens, SHARE_WORDS)) intent = "share"

  const measure = pickMeasure(columns, qTokens)
  const value = `CAST(COALESCE(${measure.expr}, 0) AS DOUBLE) AS value`
  const filter = periodFilter(folded, date)

  let plan: QueryPlan
  if (intent === "trend") {
    if (!date) return fail(columns, "Zaman trendi için tabloda tarih sütunu bulunamadı.")
    const d = quoteIdent(date.name)
    const { unit, pattern, format } = pickGrain(qTokens)
    plan = xyPlan(
      "line",
      { key: "label", label: date.name, format, total: false },
      measure,
      `SELECT strftime(date_trunc('${unit}', ${d}), '${pattern}') AS label, ${value}
FROM data
${where([`${d} IS NOT NULL`, filter])}
GROUP BY 1
ORDER BY 1`,
    )
  } else {
    if (!dim) return fail(columns, "Gruplamak için metin türünde bir sütun bulunamadı.")
    const g = quoteIdent(dim.name)
    const filters = where([`${g} IS NOT NULL`, filter])
    const x: OutputColumn = { key: "label", label: dim.name, format: "text", total: false }
    if (intent === "share") {
      // The client folds small slices into "Diğer"; return every group here.
      plan = xyPlan(
        "pie",
        x,
        measure,
        `SELECT CAST(${g} AS VARCHAR) AS label, ${value}
FROM data
${filters}
GROUP BY 1
ORDER BY value DESC`,
      )
    } else {
      const order = ASC_PHRASES.some((p) => folded.includes(p)) ? "ASC" : "DESC"
      plan = xyPlan(
        "bar",
        x,
        measure,
        `SELECT CAST(${g} AS VARCHAR) AS label, ${value}
FROM data
${filters}
GROUP BY 1
ORDER BY value ${order}
LIMIT ${pickTopN(qTokens)}`,
      )
    }
  }
  return { ok: true, plan }
}

export const mockTranslator: QueryTranslator = {
  translate: (request) => Promise.resolve(planQuery(request)),
}
