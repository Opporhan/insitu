/**
 * Two-table check: the sample sales (data) with monthly targets per city ("hedefler",
 * 9 rows per city — a join on raw rows would multiply totals by 9). Every answer is compared
 * with a hand-written reference query.
 *
 *   npm run eval:joins
 */
import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DuckDBInstance } from "@duckdb/node-api"
import { buildCleanTableSql, decideColumn, profileColumns } from "@/lib/engine/clean"
import { guardSql } from "@/lib/engine/guard"
import { normalizeSql, strictNumericCasts } from "@/lib/engine/normalize"
import { ingest } from "@/lib/ingest"
import type { Column, ColumnType } from "@/lib/schema"
import { translator } from "@/lib/translator"

const conn = await (await DuckDBInstance.create(":memory:")).connect()
const rows = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJS() as Record<string, unknown>[]
const toType = (t: string): ColumnType => (/^(DATE|TIMESTAMP)/.test(t) ? "date" : /INT|FLOAT|DOUBLE|DECIMAL/.test(t) ? "number" : "text")

async function load(path: string, table: string): Promise<Column[]> {
  const bytes = readFileSync(path)
  const res = await ingest(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  if (res.kind !== "table") throw new Error("table expected")
  const tmp = join(tmpdir(), `insitu-join-${table}-${process.pid}.csv`)
  writeFileSync(tmp, res.csv)
  await conn.run(`CREATE TABLE "raw_${table}" AS SELECT * FROM read_csv('${tmp}', header = true, all_varchar = true, delim = ',', quote = '"', escape = '"')`)
  const names = (await rows(`DESCRIBE "raw_${table}"`)).map((r) => String(r["column_name"]))
  const profiles = await profileColumns(async (sql) => (await rows(sql))[0] ?? {}, `"raw_${table}"`, names)
  await conn.run(buildCleanTableSql(`"${table}"`, `"raw_${table}"`, profiles.map((p, i) => decideColumn(names[i] ?? "", p))))
  return (await rows(`DESCRIBE "${table}"`)).map((r) => ({ name: String(r["column_name"]), type: toType(String(r["column_type"])) }))
}

const columns = await load("public/samples/satislar.csv", "data")
const targetColumns = await load("scripts/fixtures/hedefler.csv", "hedefler")
const staffColumns = await load("scripts/fixtures/personel.csv", "personel")
const tables = [
  { name: "hedefler", columns: targetColumns },
  { name: "personel", columns: staffColumns },
]

async function run(sql: string): Promise<Record<string, unknown>[] | string> {
  const g = guardSql(sql)
  if (!g.ok) return g.error
  try {
    const safe = strictNumericCasts(g.sql)
    const cols = (await rows(`DESCRIBE ${safe}`)).map((r) => ({ name: String(r["column_name"]), type: String(r["column_type"]) }))
    const n = normalizeSql(safe, cols)
    return n.ok ? await rows(n.sql) : n.error
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Every number of the reference result must appear in the answer (order and names may differ). */
const numbers = (r: Record<string, unknown>[]) =>
  r.flatMap((row) => Object.values(row).filter((v): v is number => typeof v === "number").map((v) => Math.round(v * 100) / 100)).sort((a, b) => a - b)

const cases: { q: string; ref: string }[] = [
  {
    q: "Şehirlere göre toplam ciro ve toplam hedefi karşılaştır",
    ref: `WITH s AS (SELECT sehir, SUM(tutar) c FROM data GROUP BY 1), h AS (SELECT sehir, SUM(hedef_tl) h FROM hedefler GROUP BY 1) SELECT s.sehir, CAST(s.c AS DOUBLE) c, CAST(h.h AS DOUBLE) h FROM s LEFT JOIN h USING (sehir)`,
  },
  {
    q: "Şehir bazında hedefe ulaşma oranı yüzde kaç?",
    ref: `WITH s AS (SELECT sehir, SUM(tutar) c FROM data GROUP BY 1), h AS (SELECT sehir, SUM(hedef_tl) h FROM hedefler GROUP BY 1) SELECT s.sehir, 100.0 * s.c / h.h AS o FROM s JOIN h USING (sehir)`,
  },
  {
    q: "Hangi şehirler toplam hedefini tutturdu?",
    ref: `WITH s AS (SELECT sehir, SUM(tutar) c FROM data GROUP BY 1), h AS (SELECT sehir, SUM(hedef_tl) h FROM hedefler GROUP BY 1) SELECT s.sehir FROM s JOIN h USING (sehir) WHERE s.c >= h.h`,
  },
  { q: "Toplam hedef ne kadar?", ref: `SELECT CAST(SUM(hedef_tl) AS DOUBLE) FROM hedefler` },
  { q: "Toplam ciro ne kadar?", ref: `SELECT CAST(SUM(tutar) AS DOUBLE) FROM data` },
  { q: "Kategorilere göre toplam ciro", ref: `SELECT kategori, CAST(SUM(tutar) AS DOUBLE) FROM data GROUP BY 1` },
  {
    q: "Aylara göre toplam ciro ve toplam hedef",
    ref: `WITH s AS (SELECT strftime(date_trunc('month', tarih), '%Y-%m') ay, SUM(tutar) c FROM data GROUP BY 1), h AS (SELECT strftime(ay, '%Y-%m') ay, SUM(hedef_tl) h FROM hedefler GROUP BY 1) SELECT s.ay, CAST(s.c AS DOUBLE), CAST(h.h AS DOUBLE) FROM s LEFT JOIN h USING (ay)`,
  },
]

// No common key between sales and staff: the model must refuse rather than invent a join.
const refusals = ["Şehirlere göre toplam ciro ile personel maaşlarını karşılaştır"]

let passed = 0
for (const c of cases) {
  const res = await translator.translate({ question: c.q, columns, tables, locale: "tr" })
  if (!res.ok) {
    console.log(`✗ ${c.q}\n   çevrilemedi: ${res.error}`)
    continue
  }
  const got = await run(res.plan.sql)
  const ref = await rows(c.ref).catch((e: unknown) => {
    throw new Error(`reference query failed for "${c.q}": ${String(e)}`)
  })
  const ok = typeof got !== "string" && (c.q.includes("tutturdu") ? got.length === ref.length : JSON.stringify(numbers(got).filter((n) => numbers(ref).includes(n))) === JSON.stringify(numbers(ref)))
  if (ok) passed++
  console.log(`${ok ? "✓" : "✗"} ${c.q}\n   ${res.plan.sql.replace(/\s+/g, " ").slice(0, 400)}${ok ? "" : `\n   got: ${JSON.stringify(got).slice(0, 300)}\n   ref: ${JSON.stringify(ref).slice(0, 300)}`}`)
}
for (const q of refusals) {
  const res = await translator.translate({ question: q, columns, tables, locale: "tr" })
  const ok = !res.ok || !/personel/i.test(res.plan.sql)
  if (ok) passed++
  console.log(`${ok ? "✓" : "✗"} ${q}\n   ${res.ok ? res.plan.sql.replace(/\s+/g, " ").slice(0, 300) : `reddedildi: ${res.error}`}`)
}
console.log(`\n${passed}/${cases.length + refusals.length} doğru`)
