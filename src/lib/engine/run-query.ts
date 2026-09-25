import { z } from "zod"
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

export async function runQuery(sql: string): Promise<QueryResult> {
  const guarded = guardSql(sql)
  if (!guarded.ok) return { ok: false, error: guarded.error, repairable: guarded.error }

  const conn = await (await currentDb()).connect()
  try {
    const described = Described.parse((await conn.query(`DESCRIBE ${guarded.sql}`)).toArray().map((r) => r.toJSON()))
    const columns = described.map((c) => ({ name: c.column_name, type: c.column_type }))
    const normalized = normalizeSql(guarded.sql, columns)
    if (!normalized.ok) return { ok: false, error: normalized.error, repairable: normalized.error }

    // One extra row tells us whether the result was cut off.
    const table = await conn.query(`${normalized.sql} LIMIT ${MAX_RESULT_ROWS + 1}`)
    const parsed = Rows.safeParse(table.toArray().map((r) => r.toJSON()))
    if (!parsed.success) return { ok: false, error: "The query returned rows in an unexpected shape.", repairable: null }
    const complete = parsed.data.length <= MAX_RESULT_ROWS
    return { ok: true, rows: parsed.data.slice(0, MAX_RESULT_ROWS), columns: columns.map((c) => c.name), complete }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message, repairable: repairableError(message) }
  } finally {
    await conn.close()
  }
}
