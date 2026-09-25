/**
 * End-to-end check of the question → plan → DuckDB → view → insight pipeline, using the
 * same translator and result logic as the browser, with DuckDB running in Node.
 *
 *   npm run eval -- [csv] [questions.txt] > report.jsonl
 */
import { readFileSync } from "node:fs"
import { DuckDBInstance } from "@duckdb/node-api"
import { guardSql } from "@/lib/engine/guard"
import { normalizeSql, repairableError } from "@/lib/engine/normalize"
import { buildInsight } from "@/lib/insight"
import { resolveView } from "@/lib/result-view"
import { ResultRow, type Column, type ColumnType, type RepairContext } from "@/lib/schema"
import { translator } from "@/lib/translator"

const csvPath = process.argv[2] ?? "public/samples/satislar.csv"
const questionsPath = process.argv[3] ?? "scripts/questions.txt"
const questions = readFileSync(questionsPath, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))

const db = await DuckDBInstance.create(":memory:")
const conn = await db.connect()
await conn.run(`CREATE TABLE data AS SELECT * FROM read_csv_auto('${csvPath}', header = true, sample_size = -1)`)

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
  const guarded = guardSql(sql)
  if (!guarded.ok) return { ok: false, error: guarded.error, repairable: guarded.error }
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

for (const question of questions) {
  let repair: RepairContext | undefined
  let record: Record<string, unknown> = { question }
  for (let attempt = 0; attempt < 2; attempt++) {
    let res = await translator.translate(repair ? { question, columns, repair } : { question, columns })
    for (let wait = 0; !res.ok && res.error.includes("kota") && wait < 3; wait++) {
      await sleep(65_000)
      res = await translator.translate(repair ? { question, columns, repair } : { question, columns })
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
  console.log(JSON.stringify(record))
  await sleep(3_000)
}
