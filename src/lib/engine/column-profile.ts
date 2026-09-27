import { quoteIdent } from "@/lib/sql"
import type { Column } from "@/lib/schema"

/**
 * A short summary of every column (filled share, distinct values, range, most frequent
 * values), computed in the browser right after loading. It helps the user phrase questions;
 * none of it is ever sent anywhere.
 */
export type ColumnSummary = {
  name: string
  type: Column["type"]
  filled: number
  /** Approximate for large columns (HyperLogLog), exact enough to tell "5 cities" from "5,000 ids". */
  distinct: number
  min: number | string | null
  max: number | string | null
  /** Text columns: most frequent values with their counts. */
  top: { value: string; count: number }[]
}

export const MAX_PROFILED_COLUMNS = 100
const MAX_TOP_COLUMNS = 40
const TOP_VALUES = 3

type Query = (sql: string) => Promise<Record<string, unknown>[]>

const num = (v: unknown): number => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0))
const value = (v: unknown): number | string | null =>
  v === null || v === undefined ? null : typeof v === "bigint" ? Number(v) : typeof v === "number" || typeof v === "string" ? v : String(v)

export async function profileTable(query: Query, table: string, columns: readonly Column[]): Promise<ColumnSummary[]> {
  const cols = columns.slice(0, MAX_PROFILED_COLUMNS)
  if (cols.length === 0) return []
  const parts = cols.flatMap((c, i) => {
    const q = quoteIdent(c.name)
    const range =
      c.type === "number"
        ? [`CAST(min(${q}) AS DOUBLE) AS lo${i}`, `CAST(max(${q}) AS DOUBLE) AS hi${i}`]
        : c.type === "date"
          ? [`strftime(min(${q}), '%Y-%m-%d %H:%M') AS lo${i}`, `strftime(max(${q}), '%Y-%m-%d %H:%M') AS hi${i}`]
          : []
    return [`count(${q}) AS f${i}`, `approx_count_distinct(${q}) AS d${i}`, ...range]
  })
  const [stats = {}] = await query(`SELECT ${parts.join(", ")} FROM ${table}`)

  const tops = new Map<string, { value: string; count: number }[]>()
  for (const c of cols.filter((c) => c.type === "text").slice(0, MAX_TOP_COLUMNS)) {
    const q = quoteIdent(c.name)
    const rows = await query(
      `SELECT CAST(${q} AS VARCHAR) AS v, count(*) AS n FROM ${table} WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${TOP_VALUES}`,
    )
    tops.set(
      c.name,
      rows.map((r) => ({ value: String(r["v"] ?? ""), count: num(r["n"]) })),
    )
  }

  return cols.map((c, i) => ({
    name: c.name,
    type: c.type,
    filled: num(stats[`f${i}`]),
    distinct: num(stats[`d${i}`]),
    min: value(stats[`lo${i}`]),
    max: value(stats[`hi${i}`]),
    top: tops.get(c.name) ?? [],
  }))
}
