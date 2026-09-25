/**
 * Last line of defence before translator-generated SQL reaches DuckDB.
 * Deliberately conservative: a false rejection is a retry, a false accept is a leak.
 */
const FORBIDDEN =
  /\b(insert|update|delete|drop|create|alter|attach|detach|copy|export|import|install|load|pragma|set|reset|call|checkpoint|vacuum|read_csv|read_csv_auto|read_parquet|read_json|read_json_auto|read_text|read_blob|glob|parquet_scan|sniff_csv)\b/i

export type GuardResult = { ok: true; sql: string } | { ok: false; error: string }

export function guardSql(input: string): GuardResult {
  const sql = input.trim().replace(/;\s*$/, "")
  if (sql.includes(";")) return { ok: false, error: "Only a single SQL statement is allowed." }
  if (/--|\/\*/.test(sql)) return { ok: false, error: "SQL comments are not allowed." }
  if (!/^(select|with)\b/i.test(sql)) return { ok: false, error: "Only SELECT queries are allowed." }
  const hit = FORBIDDEN.exec(sql)
  if (hit) return { ok: false, error: `Disallowed SQL keyword: ${hit[0]}` }
  return { ok: true, sql }
}
