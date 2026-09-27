import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api"
import { beforeAll, describe, expect, it } from "vitest"
import { buildCleanTableSql, decideColumn, profileColumns } from "@/lib/engine/clean"
import { profileTable } from "@/lib/engine/column-profile"
import { computeOverview } from "@/lib/engine/overview"
import { ingest } from "@/lib/ingest"
import type { Column } from "@/lib/schema"

let conn: DuckDBConnection
const rows = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJS() as Record<string, unknown>[]

/** The app's load pipeline on a CSV text → table `data`, returning its columns. */
async function load(csvText: string, name = "t.csv"): Promise<Column[]> {
  const bytes = new TextEncoder().encode(csvText)
  const res = await ingest(name, bytes.buffer.slice(0) as ArrayBuffer)
  if (res.kind !== "table") throw new Error("table expected")
  const path = join(tmpdir(), `insitu-ov-${process.pid}-${Math.random().toString(36).slice(2)}.csv`)
  writeFileSync(path, res.csv)
  await conn.run(`CREATE OR REPLACE TABLE raw AS SELECT * FROM read_csv('${path}', header = true, all_varchar = true, delim = ',', quote = '"', escape = '"')`)
  const names = (res.csv.split("\r\n")[0] ?? "").split(",")
  const profiles = await profileColumns(async (sql) => (await rows(sql))[0] ?? {}, "raw", names)
  await conn.run("DROP TABLE IF EXISTS data")
  await conn.run(buildCleanTableSql("data", "raw", profiles.map((p, i) => decideColumn(names[i] ?? "", p))))
  return (await rows("DESCRIBE data")).map((r) => {
    const t = String(r["column_type"])
    return { name: String(r["column_name"]), type: /DATE|TIMESTAMP/.test(t) ? "date" : /INT|DECIMAL|DOUBLE/.test(t) ? "number" : "text" }
  })
}

beforeAll(async () => {
  conn = await (await DuckDBInstance.create(":memory:")).connect()
})

describe("computeOverview", () => {
  it("finds exact totals, shares, complete-month trends, the return rate and duplicates on the sample", async () => {
    const columns = await load(readFileSync("public/samples/satislar.csv", "utf8"))
    const profile = await profileTable(rows, "data", columns)
    const o = await computeOverview(rows, "data", columns, profile)
    expect(o.measure).toEqual({ name: "tutar", format: "currency" })
    const byKind = (k: string) => o.findings.filter((f) => f.kind === k)
    expect(byKind("total")[0]).toMatchObject({ rows: 2574, total: 6144813 })
    expect(byKind("top")[0]).toMatchObject({ dim: "sehir", value: "İstanbul", amount: 2184772 })
    // The data ends on 24 September: September is incomplete and never compared.
    expect(byKind("bestMonth")[0]).toMatchObject({ month: "2026-07", amount: 889115 })
    expect(byKind("trend")[0]).toMatchObject({ from: "2026-01", to: "2026-08" })
    // "Kredi Kartı" is not a return; "İade" is.
    expect(byKind("status")[0]).toMatchObject({ column: "durum", value: "İade", rows: 72 })
    expect(o.warnings).toContainEqual({ kind: "duplicates", count: 16 })
  })

  it("flags rare extreme values and negatives, and gives no shares when values are negative", async () => {
    const lines = ["sube,tutar"]
    for (let i = 0; i < 200; i++) lines.push(`Şube ${i % 4},${100 + (i % 10)}`)
    lines.push("Şube 1,250000", "Şube 2,-40")
    const columns = await load(lines.join("\n"))
    const profile = await profileTable(rows, "data", columns)
    const o = await computeOverview(rows, "data", columns, profile)
    expect(o.warnings).toContainEqual(expect.objectContaining({ kind: "outliers", count: 1, max: 250000 }))
    expect(o.warnings).toContainEqual(expect.objectContaining({ kind: "negatives", count: 1 }))
    expect(o.findings.some((f) => f.kind === "top")).toBe(false)
  })

  it("works without a money column, counting records", async () => {
    const columns = await load("sehir,urun\nİzmir,Çay\nİzmir,Kahve\nAnkara,Çay\n")
    const profile = await profileTable(rows, "data", columns)
    const o = await computeOverview(rows, "data", columns, profile)
    expect(o.measure).toBeNull()
    expect(o.findings[0]).toMatchObject({ kind: "total", rows: 3, total: null })
    expect(o.findings[1]).toMatchObject({ kind: "top", dim: "sehir", value: "İzmir", amount: 2 })
  })
})
