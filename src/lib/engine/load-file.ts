import type { Column, ColumnType } from "@/lib/schema"
import { buildCleanTableSql, decideColumn, profileSql, readProfile, type CleanKind } from "./clean"
import { freshDb } from "./duckdb"
import { extension, type PrepareRequest, type PrepareResponse } from "./prepare"

export type Dataset = {
  fileName: string
  rowCount: number
  columns: Column[]
  /** Columns whose representation the cleaner changed (shown to the user). */
  cleaned: { column: string; kind: CleanKind; currencyStripped: boolean }[]
}

export const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".txt", ".xlsx", ".xls"] as const

const INPUT_FILE = "input.csv"

export function isAccepted(name: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension(name))
}

/** Excel parsing and re-encoding happen in a worker so large files never freeze the page. */
function prepareInWorker(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./prepare.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (e: MessageEvent<PrepareResponse>) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data.bytes)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || "prepare failed"))
    }
    worker.postMessage({ file } satisfies PrepareRequest)
  })
}

function toColumnType(duckType: string): ColumnType {
  const t = duckType.toUpperCase()
  if (/^(DATE|TIMESTAMP)/.test(t)) return "date"
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|DECIMAL)/.test(t)) {
    return "number"
  }
  return "text"
}

/**
 * Reads a CSV/Excel file into DuckDB table `data`, entirely in the browser. All heavy
 * work runs in workers (file preparation, DuckDB); the main thread only awaits.
 */
export async function loadFile(file: File): Promise<Dataset> {
  const bytes = await prepareInWorker(file)
  const db = await freshDb()
  await db.registerFileBuffer(INPUT_FILE, bytes)
  const conn = await db.connect()
  try {
    // Every column as text first; the cleaner decides types (see clean.ts).
    await conn.query(`CREATE TABLE raw AS SELECT * FROM read_csv('${INPUT_FILE}', header = true, all_varchar = true)`)
    await db.dropFile(INPUT_FILE)

    const rawColumns = (await conn.query("DESCRIBE raw")).toArray().map((r) => String(r.toJSON().column_name))
    // Error messages that are codes get a localized text in the UI (see i18n `file.codes`).
    if (rawColumns.length === 0) throw new Error("no-columns")
    const profileRow = (await conn.query(profileSql("raw", rawColumns))).toArray()[0]?.toJSON() ?? {}
    const decisions = rawColumns.map((name, i) => decideColumn(name, readProfile(profileRow, i)))
    await conn.query(buildCleanTableSql("data", "raw", decisions))
    await conn.query("DROP TABLE raw")

    // From here on, queries can only see the in-memory table.
    await conn.query("SET enable_external_access = false")
    await conn.query("SET lock_configuration = true")

    const described = (await conn.query("DESCRIBE data")).toArray() as { column_name: string; column_type: string }[]
    const counted = (await conn.query("SELECT count(*)::INTEGER AS n FROM data")).toArray() as { n: number }[]
    return {
      fileName: file.name,
      rowCount: counted[0]?.n ?? 0,
      columns: described.map((c) => ({ name: c.column_name, type: toColumnType(c.column_type) })),
      cleaned: decisions.flatMap((d) =>
        d.converted ? [{ column: d.name, kind: d.kind, currencyStripped: d.currencyStripped }] : [],
      ),
    }
  } finally {
    await conn.close()
  }
}
