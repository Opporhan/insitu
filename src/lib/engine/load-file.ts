import { extension, type IngestReport, type PdfProgress, type SheetInfo } from "@/lib/ingest"
import { ResultRow, type Column, type ColumnType } from "@/lib/schema"
import { buildCleanTableSql, decideColumn, profileColumns, type CleanKind } from "./clean"
import { profileTable, type ColumnSummary } from "./column-profile"
import { computeOverview, type Overview } from "./overview"
import type { Coverage } from "@/lib/insight"
import { freshDb } from "./duckdb"
import { normalizeSql } from "./normalize"
import { sanitizeName } from "@/lib/ingest/tidy"
import { quoteIdent } from "@/lib/sql"
import type { PrepareRequest, PrepareResponse, PreparedTable } from "./prepare"

export type Dataset = {
  /** Always "data" for the file opened first. */
  table: string
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
  /** Per-column summary (filled, distinct, range, most frequent values), computed locally. */
  profile: ColumnSummary[]
  /** First-look findings and warnings, computed locally before any question. */
  overview: Overview
  /** First and last day of the file's only date column (null with none or several). */
  coverage: Coverage | null
  /** Extra tables loaded next to `data` (other files), each under its own name. */
  linked: TableData[]
  /** The prepared files behind every table, kept to rebuild the database. */
  sources: Source[]
}

export type LoadResult = { kind: "sheets"; sheets: SheetInfo[] } | { kind: "dataset"; dataset: Dataset }

export const PREVIEW_ROWS = 20

export const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".txt", ".xlsx", ".xls", ".xlsm", ".pdf"] as const

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

/** With exactly one date column, its range tells which months the data covers completely. */
function coverageOf(profile: readonly ColumnSummary[]): Coverage | null {
  const dates = profile.filter((c) => c.type === "date")
  const [only] = dates
  if (dates.length !== 1 || !only || typeof only.min !== "string" || typeof only.max !== "string") return null
  return { from: only.min, to: only.max }
}

function toColumnType(duckType: string): ColumnType {
  const t = duckType.toUpperCase()
  if (/^(DATE|TIMESTAMP)/.test(t)) return "date"
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|DECIMAL)/.test(t)) {
    return "number"
  }
  return "text"
}

/** A prepared file kept in memory, so the database can be rebuilt when a table is added or removed. */
export type Source = { table: string; fileName: string; bytes: Uint8Array<ArrayBuffer>; report: IngestReport }

/** Everything the app knows about one loaded table. */
export type TableData = {
  table: string
  fileName: string
  rowCount: number
  columns: Column[]
  cleaned: Dataset["cleaned"]
  unreadable: Dataset["unreadable"]
  ambiguous: string[]
  report: IngestReport
  preview: ResultRow[]
  profile: ColumnSummary[]
}

/** At most this many extra tables next to `data`. */
export const MAX_LINKED_TABLES = 3

const RESERVED = /^(data|raw|select|from|where|group|order|by|table|limit|join|union|all|and|or|not|as|on|in|case|when|then|else|end|with|having|distinct|values|null|true|false)$/

/** A DuckDB-safe, unique table name from a file name ("Hedefler 2026.xlsx" → "hedefler_2026"). */
export function tableNameFor(fileName: string, taken: readonly string[], sheet?: string | null): string {
  const stem = fileName.replace(/\.[^.]+$/, "")
  let base = sanitizeName(sheet ? `${stem} ${sheet}` : stem) || "tablo"
  if (/^kolon_/.test(base)) base = base.replace(/^kolon_/, "tablo_")
  if (RESERVED.test(base)) base = `${base}_tablo`
  let name = base
  for (let n = 2; taken.includes(name); n++) name = `${base}_${n}`
  return name
}

type Conn = Awaited<ReturnType<Awaited<ReturnType<typeof freshDb>>["connect"]>>
type Db = Awaited<ReturnType<typeof freshDb>>

async function loadTable(db: Db, conn: Conn, source: Source): Promise<TableData> {
  const input = `${source.table}.csv`
  // A copy: DuckDB takes the buffer, and the source is kept for rebuilding the database.
  await db.registerFileBuffer(input, source.bytes.slice())
  const raw = `raw_${source.table}`
  // The worker produced clean RFC 4180 CSV, so the dialect is fixed rather than sniffed.
  // Every column is text first; the cleaner decides types (see clean.ts).
  await conn.query(
    `CREATE TABLE ${quoteIdent(raw)} AS SELECT * FROM read_csv('${input}', header = true, all_varchar = true, delim = ',', quote = '"', escape = '"', null_padding = true)`,
  )
  await db.dropFile(input)

  const rawColumns = (await conn.query(`DESCRIBE ${quoteIdent(raw)}`)).toArray().map((r) => String(r.toJSON().column_name))
  // Error messages that are codes get a localized text in the UI (see i18n `file.codes`).
  if (rawColumns.length === 0) throw new Error("no-columns")
  const profiles = await profileColumns(
    async (sql) => ((await conn.query(sql)).toArray()[0]?.toJSON() ?? {}) as Record<string, unknown>,
    quoteIdent(raw),
    rawColumns,
  )
  // profileColumns returns exactly one profile per column, in order.
  const decisions = profiles.map((profile, i) => decideColumn(rawColumns[i] ?? "", profile))
  await conn.query(buildCleanTableSql(quoteIdent(source.table), quoteIdent(raw), decisions))
  await conn.query(`DROP TABLE ${quoteIdent(raw)}`)

  const described = (await conn.query(`DESCRIBE ${quoteIdent(source.table)}`)).toArray() as { column_name: string; column_type: string }[]
  const counted = (await conn.query(`SELECT count(*)::INTEGER AS n FROM ${quoteIdent(source.table)}`)).toArray() as { n: number }[]
  const normalized = normalizeSql(
    `SELECT * FROM ${quoteIdent(source.table)} LIMIT ${PREVIEW_ROWS}`,
    described.map((c) => ({ name: c.column_name, type: c.column_type })),
  )
  const preview = normalized.ok ? (await conn.query(normalized.sql)).toArray().map((r) => ResultRow.parse(r.toJSON())) : []
  const columns = described.map((c) => ({ name: c.column_name, type: toColumnType(c.column_type) }))
  const profile = await profileTable(rowsOf(conn), quoteIdent(source.table), columns)
  return {
    table: source.table,
    fileName: source.fileName,
    rowCount: counted[0]?.n ?? 0,
    columns,
    cleaned: decisions.flatMap((d) => (d.converted ? [{ column: d.name, kind: d.kind, currencyStripped: d.currencyStripped }] : [])),
    unreadable: decisions.flatMap((d) => (d.unreadable > 0 ? [{ column: d.name, count: d.unreadable }] : [])),
    ambiguous: decisions.flatMap((d) => (d.ambiguous ? [d.name] : [])),
    report: source.report,
    preview,
    profile,
  }
}

const rowsOf = (conn: Conn) => async (sql: string) => (await conn.query(sql)).toArray().map((r) => r.toJSON() as Record<string, unknown>)

/**
 * A fresh in-browser database with every source as its own table (`data` first), locked
 * afterwards. Rebuilt from the kept sources whenever a table is added or removed, because
 * external access cannot be re-enabled once locked.
 */
async function buildDatabase(sources: readonly Source[]): Promise<Dataset> {
  const db = await freshDb()
  const conn = await db.connect()
  try {
    const tables: TableData[] = []
    for (const source of sources) tables.push(await loadTable(db, conn, source))

    // From here on, queries can only see the in-memory tables.
    await conn.query("SET enable_external_access = false")
    await conn.query("SET lock_configuration = true")

    const [main, ...linked] = tables
    if (!main) throw new Error("no-columns")
    const overview = await computeOverview(rowsOf(conn), "data", main.columns, main.profile)
    return { ...main, overview, coverage: coverageOf(main.profile), linked, sources: [...sources] }
  } finally {
    await conn.close()
  }
}

async function prepare(file: File, sheet: string | undefined, onProgress: (p: PdfProgress) => void) {
  const prepared = await prepareInWorker(file, sheet, onProgress)
  if (prepared.kind === "sheets" && prepared.tables) preparedTables.set(file, prepared.tables)
  return prepared
}

/**
 * Reads a CSV/Excel/PDF file into DuckDB table `data`, entirely in the browser. All heavy
 * work runs in workers (file preparation, DuckDB); the main thread only awaits.
 */
export async function loadFile(file: File, sheet?: string, onProgress: (p: PdfProgress) => void = () => {}): Promise<LoadResult> {
  const prepared = await prepare(file, sheet, onProgress)
  if (prepared.kind === "sheets") return { kind: "sheets", sheets: prepared.sheets }
  const dataset = await buildDatabase([{ table: "data", fileName: file.name, bytes: prepared.bytes, report: prepared.report }])
  return { kind: "dataset", dataset }
}

/** Adds a file as another table next to `data` (its own name, e.g. "hedefler"). */
export async function addTableFile(
  dataset: Dataset,
  file: File,
  sheet?: string,
  onProgress: (p: PdfProgress) => void = () => {},
): Promise<LoadResult> {
  if (dataset.linked.length >= MAX_LINKED_TABLES) throw new Error("too-many-tables")
  const prepared = await prepare(file, sheet, onProgress)
  if (prepared.kind === "sheets") return { kind: "sheets", sheets: prepared.sheets }
  const table = tableNameFor(
    file.name,
    dataset.sources.map((s) => s.table),
    prepared.report.sheet && prepared.report.source !== "pdf" ? prepared.report.sheet : null,
  )
  const dataset2 = await buildDatabase([...dataset.sources, { table, fileName: file.name, bytes: prepared.bytes, report: prepared.report }])
  return { kind: "dataset", dataset: dataset2 }
}

/** Replaces the main table (e.g. another sheet of the same workbook), keeping the extra tables. */
export async function replaceMainTable(
  dataset: Dataset,
  file: File,
  sheet?: string,
  onProgress: (p: PdfProgress) => void = () => {},
): Promise<LoadResult> {
  const prepared = await prepare(file, sheet, onProgress)
  if (prepared.kind === "sheets") return { kind: "sheets", sheets: prepared.sheets }
  const main: Source = { table: "data", fileName: file.name, bytes: prepared.bytes, report: prepared.report }
  return { kind: "dataset", dataset: await buildDatabase([main, ...dataset.sources.filter((s) => s.table !== "data")]) }
}

/** Removes an extra table (the database is rebuilt without it). */
export async function removeLinkedTable(dataset: Dataset, table: string): Promise<Dataset> {
  return buildDatabase(dataset.sources.filter((s) => s.table === "data" || s.table !== table))
}
