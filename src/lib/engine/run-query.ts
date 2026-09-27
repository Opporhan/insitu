import { z } from "zod"
import { CHUNK_ROWS, yieldToBrowser } from "@/lib/schedule"
import { ResultRow } from "@/lib/schema"
import { currentDb } from "./duckdb"
import { guardSql } from "./guard"
import { normalizeSql, repairableError, strictNumericCasts, type BooleanWords } from "./normalize"

/** Rows brought back to the main thread; more than this and the result is marked partial. */
export const MAX_RESULT_ROWS = 10_000

export type QueryResult =
  | { ok: true; rows: ResultRow[]; columns: string[]; complete: boolean }
  | { ok: false; error: string; repairable: string | null }

const Rows = z.array(ResultRow)
const Described = z.array(z.object({ column_name: z.string(), column_type: z.string() }))

/** Upper bound for "export everything" so a runaway query cannot exhaust browser memory. */
export const MAX_EXPORT_ROWS = 1_000_000

/**
 * Longest a query may run. Questions finish in milliseconds; this only stops a runaway query
 * (a huge self-join, a hand-edited or shared SQL) from keeping the engine busy forever.
 */
export const QUERY_TIMEOUT_MS = 60_000
export const QUERY_TIMEOUT = "query-timeout"

export async function runQuery(
  sql: string,
  maxRows = MAX_RESULT_ROWS,
  booleans?: BooleanWords,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<QueryResult> {
  const checked = guardSql(sql)
  if (!checked.ok) return { ok: false, error: checked.error, repairable: checked.error }
  const guarded = { sql: strictNumericCasts(checked.sql) }

  const conn = await (await currentDb()).connect()
  try {
    const described = Described.parse((await conn.query(`DESCRIBE ${guarded.sql}`)).toArray().map((r) => r.toJSON()))
    const columns = described.map((c) => ({ name: c.column_name, type: c.column_type }))
    const normalized = normalizeSql(guarded.sql, columns, booleans)
    if (!normalized.ok) return { ok: false, error: normalized.error, repairable: normalized.error }

    // Sent (not run) so it can be cancelled; one extra row tells us whether the result was cut off.
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      void conn.cancelSent()
    }, timeoutMs)
    const rows: ResultRow[] = []
    try {
      const reader = await conn.send(`${normalized.sql} LIMIT ${maxRows + 1}`, true)
      // Arrow → JS objects batch by batch, yielding between them, so large exports never freeze the page.
      for await (const batch of reader) {
        for (let start = 0; start < batch.numRows; start += CHUNK_ROWS) {
          const chunk = batch.slice(start, Math.min(batch.numRows, start + CHUNK_ROWS))
          const parsed = Rows.safeParse(chunk.toArray().map((r) => r.toJSON()))
          if (!parsed.success) return { ok: false, error: "The query returned rows in an unexpected shape.", repairable: null }
          rows.push(...parsed.data)
          await yieldToBrowser()
        }
      }
    } catch (e) {
      if (timedOut) return { ok: false, error: QUERY_TIMEOUT, repairable: null }
      throw e
    } finally {
      clearTimeout(timer)
    }
    if (timedOut) return { ok: false, error: QUERY_TIMEOUT, repairable: null }
    const complete = rows.length <= maxRows
    return { ok: true, rows: rows.slice(0, maxRows), columns: columns.map((c) => c.name), complete }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message, repairable: repairableError(message) }
  } finally {
    await conn.close()
  }
}
