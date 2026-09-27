import { extension, type IngestReport, type PdfProgress, type SheetInfo } from "@/lib/ingest"
import { ResultRow, type Column, type ColumnType } from "@/lib/schema"
import { buildCleanTableSql, decideColumn, profileColumns, type CleanKind } from "./clean"
import { freshDb } from "./duckdb"
import { normalizeSql } from "./normalize"
import type { PrepareRequest, PrepareResponse, PreparedTable } from "./prepare"

export type Dataset = {
  fileName: string
  rowCount: number
  columns: Column[]
  /** Columns whose representation the cleaner changed (shown to the user). */
  cleaned: { column: string; kind: CleanKind; currencyStripped: boolean }[]
  /** Columns that look numeric but contain values that are not numbers; kept as text. */
  unreadable: { column: string; count: number }[]
  /** Columns of numbers like "1,250" (1.25 or 1250?), kept as text. */
  ambiguous: string[]
  /** What ingestion did to the raw file (header row, removed rows, renamed columns…). */
  report: IngestReport
  /** First rows of the cleaned table, for the data preview. */
  preview: ResultRow[]
}

export type LoadResult = { kind: "sheets"; sheets: SheetInfo[] } | { kind: "dataset"; dataset: Dataset }

export const PREVIEW_ROWS = 20

export const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".txt", ".xlsx", ".xls", ".xlsm", ".pdf"] as const

const INPUT_FILE = "input.csv"

export function isAccepted(name: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension(name))
}

type Prepared = Exclude<PrepareResponse, { ok: false } | { kind: "progress" }>

/** Tables of a multi-table PDF, prepared once; picking another table does not read (or OCR) the file again. */
const preparedTables = new WeakMap<File, Record<string, PreparedTable>>()

/** The whole ingestion pipeline runs in a worker so large files never freeze the page. */
function prepareInWorker(file: File, sheet: string | undefined, onProgress: (p: PdfProgress) => void): Promise<Prepared> {
  const cached = sheet !== undefined ? preparedTables.get(file)?.[sheet] : undefined
  if (cached) return Promise.resolve({ ok: true, kind: "table", ...cached })
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./prepare.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (e: MessageEvent<PrepareResponse>) => {
      if (e.data.ok && e.data.kind === "progress") {
        onProgress(e.data.progress)
        return
      }
      worker.terminate()
      if (e.data.ok) resolve(e.data)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || "prepare failed"))
    }
    worker.postMessage((sheet === undefined ? { file } : { file, sheet }) satisfies PrepareRequest)
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
 * Reads a CSV/Excel/PDF file into DuckDB table `data`, entirely in the browser. All heavy
 * work runs in workers (file preparation, DuckDB); the main thread only awaits.
 */
export async function loadFile(file: File, sheet?: string, onProgress: (p: PdfProgress) => void = () => {}): Promise<LoadResult> {
  const prepared = await prepareInWorker(file, sheet, onProgress)
  if (prepared.kind === "sheets") {
    if (prepared.tables) preparedTables.set(file, prepared.tables)
    return { kind: "sheets", sheets: prepared.sheets }
  }

  const db = await freshDb()
  // A copy, so a cached PDF table stays usable when the user picks it again.
  await db.registerFileBuffer(INPUT_FILE, prepared.bytes.slice())
  const conn = await db.connect()
  try {
    // The worker produced clean RFC 4180 CSV, so the dialect is fixed rather than sniffed.
    // Every column is text first; the cleaner decides types (see clean.ts).
    await conn.query(
      `CREATE TABLE raw AS SELECT * FROM read_csv('${INPUT_FILE}', header = true, all_varchar = true, delim = ',', quote = '"', escape = '"', null_padding = true)`,
    )
    await db.dropFile(INPUT_FILE)

    const rawColumns = (await conn.query("DESCRIBE raw")).toArray().map((r) => String(r.toJSON().column_name))
    // Error messages that are codes get a localized text in the UI (see i18n `file.codes`).
    if (rawColumns.length === 0) throw new Error("no-columns")
    const profiles = await profileColumns(
      async (sql) => ((await conn.query(sql)).toArray()[0]?.toJSON() ?? {}) as Record<string, unknown>,
      "raw",
      rawColumns,
    )
    // profileColumns returns exactly one profile per column, in order.
    const decisions = profiles.map((profile, i) => decideColumn(rawColumns[i] ?? "", profile))
    await conn.query(buildCleanTableSql("data", "raw", decisions))
    await conn.query("DROP TABLE raw")

    // From here on, queries can only see the in-memory table.
    await conn.query("SET enable_external_access = false")
    await conn.query("SET lock_configuration = true")

    const described = (await conn.query("DESCRIBE data")).toArray() as { column_name: string; column_type: string }[]
    const counted = (await conn.query("SELECT count(*)::INTEGER AS n FROM data")).toArray() as { n: number }[]
    const normalized = normalizeSql(
      `SELECT * FROM data LIMIT ${PREVIEW_ROWS}`,
      described.map((c) => ({ name: c.column_name, type: c.column_type })),
    )
    const preview = normalized.ok
      ? (await conn.query(normalized.sql)).toArray().map((r) => ResultRow.parse(r.toJSON()))
      : []
    return {
      kind: "dataset",
      dataset: {
        fileName: file.name,
        rowCount: counted[0]?.n ?? 0,
        columns: described.map((c) => ({ name: c.column_name, type: toColumnType(c.column_type) })),
        cleaned: decisions.flatMap((d) =>
          d.converted ? [{ column: d.name, kind: d.kind, currencyStripped: d.currencyStripped }] : [],
        ),
        unreadable: decisions.flatMap((d) => (d.unreadable > 0 ? [{ column: d.name, count: d.unreadable }] : [])),
        ambiguous: decisions.flatMap((d) => (d.ambiguous ? [d.name] : [])),
        report: prepared.report,
        preview,
      },
    }
  } finally {
    await conn.close()
  }
}
