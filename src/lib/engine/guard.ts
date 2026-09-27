/**
 * Last line of defence before translator-generated SQL reaches DuckDB.
 * Deliberately conservative: a false rejection is a retry, a false accept is a leak.
 */
const FORBIDDEN =
  /\b(insert|update|delete|drop|create|alter|attach|detach|copy|export|import|install|load|pragma|set|reset|call|checkpoint|vacuum|glob|sniff_csv|query|query_table|getenv|read_\w+|\w+_scan)\b/i

/**
 * Quoted identifiers ("export", "set") and string literals ('Call Center', 'a;b', 'A--B') are
 * blanked before the checks, so real column names and values are never mistaken for SQL.
 * Unterminated quotes keep the rest of the text visible, so nothing can hide behind them, and a
 * quoted name used as a function is checked like an unquoted one.
 */
function blankQuoted(sql: string): string {
  let out = ""
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i] ?? ""
    if (quote) {
      if (c === quote && sql[i + 1] === quote) {
        i++ // escaped quote ('' or "")
      } else if (c === quote) {
        // A quoted name used as a function ("read_csv"(…)) stays visible to the checks.
        const called = quote === '"' && /^\s*\(/.test(sql.slice(i + 1))
        out += called ? sql.slice(start, i + 1).replace(/"/g, " ") : quote + " ".repeat(i - start - 1) + quote
        quote = null
      }
    } else if (c === "'" || c === '"') {
      quote = c
      start = i
    } else out += c
  }
  return quote ? out + sql.slice(start) : out
}

export type GuardResult = { ok: true; sql: string } | { ok: false; error: string }

export function guardSql(input: string): GuardResult {
  const sql = input.trim().replace(/;\s*$/, "")
  const code = blankQuoted(sql)
  if (code.includes(";")) return { ok: false, error: "Only a single SQL statement is allowed." }
  if (/--|\/\*/.test(code)) return { ok: false, error: "SQL comments are not allowed." }
  if (!/^(select|with)\b/i.test(code)) return { ok: false, error: "Only SELECT queries are allowed." }
  const hit = FORBIDDEN.exec(code)
  if (hit) return { ok: false, error: `Disallowed SQL keyword: ${hit[0]}` }
  return { ok: true, sql }
}
