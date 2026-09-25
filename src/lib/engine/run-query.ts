import { z } from "zod"
import { CHUNK_ROWS, yieldToBrowser } from "@/lib/schedule"
import { ResultRow } from "@/lib/schema"
import { currentDb } from "./duckdb"
import { guardSql } from "./guard"
import { normalizeSql, repairableError } from "./normalize"

/** Rows brought back to the main thread; more than this and the result is marked partial. */
export const MAX_RESULT_ROWS = 10_000

export type QueryResult =
  | { ok: true; rows: ResultRow[]; columns: string[]; complete: boolean }
  | { ok: false; error: string; repairable: string | null }

const Rows = z.array(ResultRow)
const Described = z.array(z.object({ column_name: z.string(), column_type: z.string() }))

/** Upper bound for "export everything" so a runaway query cannot exhaust browser memory. */
export const MAX_EXPORT_ROWS = 1_000_000

export async function runQuery(sql: string, maxRows = MAX_RESULT_ROWS): Promise<QueryResult> {
  const guarded = guardSql(sql)
  if (!guarded.ok) return { ok: false, error: guarded.error, repairable: guarded.error }

  const conn = await (await currentDb()).connect()
  try {
    const described = Described.parse((await conn.query(`DESCRIBE ${guarded.sql}`)).toArray().map((r) => r.toJSON()))
    const columns = described.map((c) => ({ name: c.column_name, type: c.column_type }))
    const normalized = normalizeSql(guarded.sql, columns)
    if (!normalized.ok) return { ok: false, error: normalized.error, repairable: normalized.error }

    // One extra row tells us whether the result was cut off.
    const table = await conn.query(`${normalized.sql} LIMIT ${maxRows + 1}`)
    // Arrow → JS objects in chunks, yielding between them, so large exports never freeze the page.
    const rows: ResultRow[] = []
    for (let start = 0; start < table.numRows; start += CHUNK_ROWS) {
      const chunk = table.slice(start, Math.min(table.numRows, start + CHUNK_ROWS))
      const parsed = Rows.safeParse(chunk.toArray().map((r) => r.toJSON()))
      if (!parsed.success) return { ok: false, error: "The query returned rows in an unexpected shape.", repairable: null }
      rows.push(...parsed.data)
      if (start + CHUNK_ROWS < table.numRows) await yieldToBrowser()
    }
    const complete = rows.length <= maxRows
    return { ok: true, rows: rows.slice(0, maxRows), columns: columns.map((c) => c.name), complete }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message, repairable: repairableError(message) }
  } finally {
    await conn.close()
  }
}
