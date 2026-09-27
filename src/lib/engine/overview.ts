import { quoteIdent } from "@/lib/sql"
import { isMoneyName } from "@/lib/sql-select"
import type { Column, ValueFormat } from "@/lib/schema"
import { isIdLike } from "@/lib/suggestions"
import type { ColumnSummary } from "./column-profile"

/**
 * "First look": a few findings and warnings computed in the browser as soon as a file is
 * loaded, before any question. Every number comes from an exact query on the file; nothing is
 * estimated, and nothing leaves the device. Findings that could mislead are left out: shares
 * only for non-negative measures, month comparisons only between complete months.
 */

export type Measure = { name: string; format: ValueFormat }

export type Finding =
  | { kind: "total"; rows: number; measure: Measure | null; total: number | null }
  | { kind: "top"; dim: string; value: string; share: number; amount: number; measure: Measure | null }
  | { kind: "bestMonth"; month: string; amount: number; measure: Measure | null }
  | { kind: "trend"; from: string; to: string; change: number; measure: Measure | null }
  | { kind: "status"; column: string; value: string; share: number; rows: number }

export type Warning =
  | { kind: "outliers"; measure: Measure; count: number; max: number; median: number }
  | { kind: "monthSpike"; month: string; amount: number; median: number; high: boolean; measure: Measure | null }
  | { kind: "negatives"; measure: Measure; count: number }
  | { kind: "duplicates"; count: number }

export type Overview = { measure: Measure | null; dims: string[]; date: string | null; findings: Finding[]; warnings: Warning[] }

type Query = (sql: string) => Promise<Record<string, unknown>[]>

const num = (v: unknown): number => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? NaN))

/** Words that mark a cancelled/returned record, as whole words ("Kredi Kartı" is not "red"). */
const STATUS_WORD = /(^|[^\p{L}])(iade|iadeler|iptal|iptal edildi|red|reddedildi|return|returned|refund|refunded|cancel|cancelled|canceled|void|rejected)([^\p{L}]|$)/u
const isStatusWord = (value: string) => STATUS_WORD.test(value.replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr"))

function pickMeasure(columns: readonly Column[], profile: readonly ColumnSummary[]): Measure | null {
  const numbers = columns.filter((c) => c.type === "number" && !isIdLike(c.name))
  const filled = (name: string) => profile.find((p) => p.name === name)?.filled ?? 0
  const money = numbers.filter((c) => isMoneyName(c.name) && filled(c.name) > 0)
  // Prefer the amount over a unit price: "tutar"/"ciro" before "birim_fiyat".
  const amount = money.find((c) => !/fiyat|price/.test(c.name)) ?? money[0]
  return amount ? { name: amount.name, format: "currency" } : null
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number)
  return new Date(Date.UTC(y ?? 2000, m ?? 1, 0)).getUTCDate()
}

export async function computeOverview(
  query: Query,
  table: string,
  columns: readonly Column[],
  profile: readonly ColumnSummary[],
): Promise<Overview> {
  const measure = pickMeasure(columns, profile)
  const m = measure ? quoteIdent(measure.name) : null
  const distinct = (name: string) => profile.find((p) => p.name === name)?.distinct ?? 0
  const dims = columns
    .filter((c) => c.type === "text" && !isIdLike(c.name) && distinct(c.name) >= 2 && distinct(c.name) <= 50)
    .map((c) => c.name)
  const date = columns.find((c) => c.type === "date")?.name ?? null
  const findings: Finding[] = []
  const warnings: Warning[] = []

  const [totals = {}] = await query(
    `SELECT count(*) AS n${m ? `, CAST(sum(${m}) AS DOUBLE) AS s, count(*) FILTER (WHERE ${m} < 0) AS neg, count(${m}) AS filled` : ""} FROM ${table}`,
  )
  const rows = num(totals["n"])
  if (rows === 0) return { measure, dims, date, findings, warnings }
  const total = m ? num(totals["s"]) : null
  const negatives = m ? num(totals["neg"]) : 0
  findings.push({ kind: "total", rows, measure, total: total !== null && Number.isFinite(total) ? total : null })

  // Shares only make sense when nothing is negative (returns would make a share above 100%).
  const shareable = !m || negatives === 0
  const value = m ? `CAST(sum(${m}) AS DOUBLE)` : "count(*)"
  const whole = m ? (total ?? 0) : rows
  if (shareable && whole > 0) {
    for (const dim of dims.slice(0, 2)) {
      const d = quoteIdent(dim)
      const [top] = await query(
        `SELECT CAST(${d} AS VARCHAR) AS v, ${value} AS s FROM ${table} WHERE ${d} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC NULLS LAST, 1 LIMIT 1`,
      )
      const amount = num(top?.["s"])
      if (top && Number.isFinite(amount) && amount > 0) {
        findings.push({ kind: "top", dim, value: String(top["v"]), share: amount / whole, amount, measure })
      }
    }
  }

  if (date) {
    const t = quoteIdent(date)
    const months = (
      await query(
        `SELECT strftime(date_trunc('month', ${t}), '%Y-%m') AS ym, ${value} AS s, min(day(${t})) AS lo, max(day(${t})) AS hi
         FROM ${table} WHERE ${t} IS NOT NULL GROUP BY 1 ORDER BY 1`,
      )
    ).map((r) => ({ ym: String(r["ym"]), amount: num(r["s"]), lo: num(r["lo"]), hi: num(r["hi"]) }))
    // A month counts as complete when the data covers it from (about) its first to its last day.
    const complete = months.filter((x) => x.lo <= 3 && x.hi >= daysInMonth(x.ym) - 3 && Number.isFinite(x.amount))
    if (complete.length >= 2) {
      const best = complete.reduce((a, b) => (b.amount > a.amount ? b : a))
      findings.push({ kind: "bestMonth", month: best.ym, amount: best.amount, measure })
    }
    const first = complete[0]
    const last = complete[complete.length - 1]
    if (complete.length >= 3 && first && last && first.amount > 0) {
      findings.push({ kind: "trend", from: first.ym, to: last.ym, change: (last.amount - first.amount) / first.amount, measure })
    }
    // Robust spike test (median and median absolute deviation) over complete months.
    if (complete.length >= 6) {
      const sorted = complete.map((x) => x.amount).sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0
      const deviations = sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b)
      const mad = (deviations[Math.floor(deviations.length / 2)] ?? 0) * 1.4826
      if (mad > 0) {
        for (const x of complete) {
          if (Math.abs(x.amount - median) / mad > 3.5) {
            warnings.push({ kind: "monthSpike", month: x.ym, amount: x.amount, median, high: x.amount > median, measure })
          }
        }
      }
    }
  }

  // A cancelled/returned status: its share of the records.
  for (const c of columns.filter((c) => c.type === "text" && distinct(c.name) >= 2 && distinct(c.name) <= 8)) {
    const q = quoteIdent(c.name)
    const values = await query(`SELECT CAST(${q} AS VARCHAR) AS v, count(*) AS n FROM ${table} WHERE ${q} IS NOT NULL GROUP BY 1`)
    const hit = values.find((v) => isStatusWord(String(v["v"])))
    if (hit) {
      const n = num(hit["n"])
      findings.push({ kind: "status", column: c.name, value: String(hit["v"]), share: n / rows, rows: n })
      break
    }
  }

  if (measure && m) {
    // Extreme outliers only (beyond Q3 + 3×IQR), and only when they are rare: a skewed
    // distribution with many large values is normal, not an anomaly.
    const [q = {}] = await query(
      `SELECT quantile_cont(${m}, 0.25) AS q1, quantile_cont(${m}, 0.5) AS med, quantile_cont(${m}, 0.75) AS q3 FROM ${table}`,
    )
    const q1 = num(q["q1"])
    const q3 = num(q["q3"])
    const median = num(q["med"])
    if (Number.isFinite(q1) && Number.isFinite(q3) && q3 > q1) {
      const fence = q3 + 3 * (q3 - q1)
      const [o = {}] = await query(
        `SELECT count(*) AS n, CAST(max(${m}) AS DOUBLE) AS mx FROM ${table} WHERE ${m} > ${fence}`,
      )
      const count = num(o["n"])
      if (count > 0 && count <= 0.05 * rows) warnings.push({ kind: "outliers", measure, count, max: num(o["mx"]), median })
    }
    if (negatives > 0 && negatives < 0.5 * num(totals["filled"])) warnings.push({ kind: "negatives", measure, count: negatives })
  }

  const [dup = {}] = await query(
    `SELECT (SELECT count(*) FROM ${table}) - (SELECT count(*) FROM (SELECT DISTINCT * FROM ${table})) AS d`,
  )
  const duplicates = num(dup["d"])
  if (duplicates > 0) warnings.push({ kind: "duplicates", count: duplicates })

  return { measure, dims, date, findings, warnings }
}
