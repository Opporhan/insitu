/**
 * End-to-end check of the question → plan → DuckDB → view → insight pipeline, using the
 * same translator and result logic as the browser, with DuckDB running in Node.
 *
 *   npm run eval -- [csv] [questions.txt] > report.jsonl
 */
import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DuckDBInstance } from "@duckdb/node-api"
import { buildCleanTableSql, decideColumn, profileColumns } from "@/lib/engine/clean"
import { guardSql } from "@/lib/engine/guard"
import { ingest } from "@/lib/ingest"
import { normalizeSql, repairableError, strictNumericCasts } from "@/lib/engine/normalize"
import { buildInsight } from "@/lib/insight"
import { resolveView } from "@/lib/result-view"
import { ResultRow, type Column, type ColumnType, type HistoryTurn, type RepairContext } from "@/lib/schema"
import { translator } from "@/lib/translator"

const csvPath = process.argv[2] ?? "public/samples/satislar.csv"
const questionsPath = process.argv[3] ?? "scripts/questions.txt"
const questions = readFileSync(questionsPath, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))

const db = await DuckDBInstance.create(":memory:")
const conn = await db.connect()
// Same pipeline as the browser: ingest (header/cleanup/names) → text table → typed table.
const fileBytes = readFileSync(csvPath)
const ingested = await ingest(csvPath, fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength))
if (ingested.kind !== "table") throw new Error("multi-sheet workbooks: pass a CSV")
const tidyPath = join(tmpdir(), `insitu-eval-${process.pid}.csv`)
writeFileSync(tidyPath, ingested.csv)
await conn.run(`CREATE TABLE raw AS SELECT * FROM read_csv('${tidyPath}', header = true, all_varchar = true, delim = ',', quote = '"', escape = '"')`)
const rawColumns = (await conn.runAndReadAll("DESCRIBE raw")).getRowObjectsJS().map((r) => String(r["column_name"]))
const profiles = await profileColumns(async (sql) => (await conn.runAndReadAll(sql)).getRowObjectsJS()[0] ?? {}, "raw", rawColumns)
await conn.run(buildCleanTableSql("data", "raw", profiles.map((p, i) => decideColumn(rawColumns[i] ?? "", p))))

function toType(t: string): ColumnType {
  if (/^(DATE|TIMESTAMP)/.test(t)) return "date"
  if (/INT|FLOAT|DOUBLE|DECIMAL|REAL|NUMERIC/.test(t)) return "number"
  return "text"
}
const describe = async (sql: string) =>
  (await conn.runAndReadAll(`DESCRIBE ${sql}`)).getRowObjectsJS().map((r) => ({ name: String(r["column_name"]), type: String(r["column_type"]) }))
const columns: Column[] = (await describe("SELECT * FROM data")).map((c) => ({ name: c.name, type: toType(c.type) }))

type Run = { ok: true; rows: ResultRow[]; keys: string[] } | { ok: false; error: string; repairable: string | null }
async function run(sql: string): Promise<Run> {
  const checked = guardSql(sql)
  if (!checked.ok) return { ok: false, error: checked.error, repairable: checked.error }
  const guarded = { sql: strictNumericCasts(checked.sql) }
  try {
    const cols = await describe(guarded.sql)
    const normalized = normalizeSql(guarded.sql, cols)
    if (!normalized.ok) return { ok: false, error: normalized.error, repairable: normalized.error }
    const rows = (await conn.runAndReadAll(normalized.sql)).getRowObjectsJS()
    return { ok: true, rows: rows.map((r) => ResultRow.parse(r)), keys: cols.map((c) => c.name) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, error: message, repairable: repairableError(message) }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A line "Q1 >> Q2 >> Q3" is one conversation: each turn is sent with the earlier ones as history.
async function ask(question: string, history: HistoryTurn[]): Promise<Record<string, unknown>> {
  let repair: RepairContext | undefined
  let record: Record<string, unknown> = { question }
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = { question, columns, ...(repair ? { repair } : {}), ...(history.length ? { history } : {}) }
    let res = await translator.translate(request)
    for (let wait = 0; !res.ok && res.error.includes("kota") && wait < 3; wait++) {
      await sleep(65_000)
      res = await translator.translate(request)
    }
    if (!res.ok) {
      record = { question, translateError: res.error }
      break
    }
    const out = await run(res.plan.sql)
    if (!out.ok) {
      record = { question, plan: res.plan, runError: out.error }
      if (attempt === 0 && out.repairable) {
        repair = { sql: res.plan.sql, error: out.repairable }
        continue
      }
      break
    }
    const view = resolveView(res.plan, out.rows, out.keys)
    record = {
      question,
      repaired: attempt > 0,
      plan: res.plan,
      view: view.kind,
      rowCount: out.rows.length,
      rows: out.rows.slice(0, 12),
      insight: buildInsight(view),
    }
    break
  }
  return record
}

for (const line of questions) {
  const turns = line.split(">>").map((q) => q.trim())
  const history: HistoryTurn[] = []
  let record: Record<string, unknown> = {}
  for (const question of turns) {
    record = await ask(question, history)
    const plan = record["plan"] as { sql: string } | undefined
    if (!plan || !("rows" in record)) break
    history.push({ question, sql: plan.sql })
  }
  console.log(JSON.stringify(turns.length > 1 ? { ...record, conversation: turns } : record))
  await sleep(3_000)
}
