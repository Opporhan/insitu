import { quoteIdent } from "@/lib/sql"

export type DescribedColumn = { name: string; type: string }

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)/

/** How true/false results read in the UI language. */
export type BooleanWords = readonly [yes: string, no: string]
const DEFAULT_BOOLEANS: BooleanWords = ["Evet", "Hayır"]
const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`

function castExpr(column: DescribedColumn, [yes, no]: BooleanWords): string {
  const c = `q.${quoteIdent(column.name)}`
  const t = column.type.toUpperCase()
  if (NUMERIC.test(t)) return `CAST(${c} AS DOUBLE)`
  if (t === "DATE") return `strftime(${c}, '%Y-%m-%d')`
  if (t.startsWith("TIMESTAMP")) return `strftime(CAST(${c} AS TIMESTAMP), '%Y-%m-%d %H:%M')`
  if (t === "BOOLEAN") return `CASE WHEN ${c} THEN ${sqlString(yes)} WHEN NOT ${c} THEN ${sqlString(no)} END`
  if (t === "VARCHAR") return c
  return `CAST(${c} AS VARCHAR)`
}

const NUMERIC_TARGET =
  /\bAS\s+(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)(\s*\(\s*\d+\s*(,\s*\d+\s*)?\))?\s*$/i

/** Aggregates whose result silently changes when some inputs become NULL. */
const AGGREGATES = new Set([
  "sum", "avg", "mean", "min", "max", "median", "mode", "product", "fsum", "sumkahan", "kahan_sum", "favg",
  "stddev", "stddev_pop", "stddev_samp", "variance", "var_pop", "var_samp", "quantile", "quantile_cont",
  "quantile_disc", "arg_max", "arg_min", "max_by", "min_by", "string_agg", "list", "count",
])

/**
 * `TRY_CAST(x AS <number>)` turns values that are not numbers into NULL, so a sum over a text
 * column silently skips them and shows a wrong total. Inside an aggregate, numeric casts are
 * made strict: such a value now fails the query instead. Elsewhere (listing rows) the NULL shows
 * as "—", which is honest. Date casts and string literals are left as they are.
 */
export function strictNumericCasts(sql: string): string {
  const head = /^TRY_CAST\s*\(/i
  // Function name (lower case) for every open parenthesis, "" for plain grouping.
  const open: string[] = []
  let out = ""
  let quote: string | null = null
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? ""
    if (quote) {
      if (c === quote) quote = null
    } else if (c === "'" || c === '"') quote = c
    else if (c === "(") open.push(/([a-z_][\w$]*)\s*$/i.exec(sql.slice(Math.max(0, i - 40), i))?.[1]?.toLowerCase() ?? "")
    else if (c === ")") open.pop()
    else if (!/[\w$]/.test(sql[i - 1] ?? "") && open.some((f) => AGGREGATES.has(f))) {
      const m = head.exec(sql.slice(i, i + 20))
      if (m) {
        // Find the matching ")" (quotes and nested parentheses skipped).
        let depth = 1
        let inQuote: string | null = null
        let j = i + m[0].length
        for (; j < sql.length && depth > 0; j++) {
          const d = sql[j]
          if (inQuote) {
            if (d === inQuote) inQuote = null
          } else if (d === "'" || d === '"') inQuote = d
          else if (d === "(") depth++
          else if (d === ")") depth--
        }
        if (depth === 0 && NUMERIC_TARGET.test(sql.slice(i + m[0].length, j - 1))) {
          out += "CAST("
          open.push("cast")
          i += m[0].length - 1
          continue
        }
      }
    }
    out += c
  }
  return out
}

export type NormalizeResult = { ok: true; sql: string } | { ok: false; error: string }

/**
 * Wraps a guarded query so every output column is a DOUBLE or VARCHAR. Arrow then
 * hands back plain JS numbers and strings — no BigInt, Decimal or Date objects —
 * which keeps formatting exact. DuckDB preserves the inner ORDER BY through the projection.
 */
export function normalizeSql(sql: string, columns: readonly DescribedColumn[], booleans: BooleanWords = DEFAULT_BOOLEANS): NormalizeResult {
  const names = columns.map((c) => c.name)
  const duplicate = names.find((n, i) => names.indexOf(n) !== i)
  if (duplicate !== undefined) return { ok: false, error: `The query returns two columns named "${duplicate}"` }
  const select = columns.map((c) => `${castExpr(c, booleans)} AS ${quoteIdent(c.name)}`).join(", ")
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
