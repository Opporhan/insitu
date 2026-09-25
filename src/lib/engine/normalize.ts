import { quoteIdent } from "@/lib/sql"

export type DescribedColumn = { name: string; type: string }

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)/

function castExpr(column: DescribedColumn): string {
  const c = `q.${quoteIdent(column.name)}`
  const t = column.type.toUpperCase()
  if (NUMERIC.test(t)) return `CAST(${c} AS DOUBLE)`
  if (t === "DATE") return `strftime(${c}, '%Y-%m-%d')`
  if (t.startsWith("TIMESTAMP")) return `strftime(CAST(${c} AS TIMESTAMP), '%Y-%m-%d %H:%M')`
  if (t === "BOOLEAN") return `CASE WHEN ${c} THEN 'Evet' WHEN NOT ${c} THEN 'Hayır' END`
  if (t === "VARCHAR") return c
  return `CAST(${c} AS VARCHAR)`
}

export type NormalizeResult = { ok: true; sql: string } | { ok: false; error: string }

/**
 * Wraps a guarded query so every output column is a DOUBLE or VARCHAR. Arrow then
 * hands back plain JS numbers and strings — no BigInt, Decimal or Date objects —
 * which keeps formatting exact. DuckDB preserves the inner ORDER BY through the projection.
 */
export function normalizeSql(sql: string, columns: readonly DescribedColumn[]): NormalizeResult {
  const names = columns.map((c) => c.name)
  const duplicate = names.find((n, i) => names.indexOf(n) !== i)
  if (duplicate !== undefined) return { ok: false, error: `The query returns two columns named "${duplicate}"` }
  const select = columns.map((c) => `${castExpr(c)} AS ${quoteIdent(c.name)}`).join(", ")
  return { ok: true, sql: `SELECT ${select} FROM (${sql}) AS q` }
}

const REPAIRABLE = /^(Binder|Parser|Catalog|Not implemented) Error/i

/**
 * Engine errors are sent back to the translator for one repair attempt, but only
 * structural ones (unknown column, syntax…), which describe the SQL rather than the
 * data. Quoted literals are masked anyway. Data-dependent errors (conversion, range)
 * return null and are never sent.
 */
export function repairableError(message: string): string | null {
  if (!REPAIRABLE.test(message)) return null
  return message.replace(/'[^']*'/g, "'…'").slice(0, 500)
}
