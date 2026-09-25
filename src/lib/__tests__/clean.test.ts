import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api"
import { beforeAll, describe, expect, it } from "vitest"
import { buildCleanTableSql, decideColumn, profileSql, readProfile } from "@/lib/engine/clean"

let conn: DuckDBConnection

beforeAll(async () => {
  conn = await (await DuckDBInstance.create(":memory:")).connect()
})

const rows = async (sql: string) =>
  (await conn.runAndReadAll(sql)).getRowObjectsJS().map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v instanceof Date ? v.toISOString() : v])),
  )

/** Loads the given columns as VARCHAR (like the app does), cleans them and returns kinds + values. */
async function clean(columns: Record<string, (string | null)[]>) {
  const names = Object.keys(columns)
  const n = Math.max(...Object.values(columns).map((c) => c.length))
  const lit = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`)
  const values = Array.from({ length: n }, (_, i) => `(${names.map((c) => `${lit(columns[c]?.[i] ?? null)}::VARCHAR`).join(", ")})`)
  await conn.run(`CREATE OR REPLACE TABLE raw AS SELECT * FROM (VALUES ${values.join(", ")}) t(${names.map((c) => `"${c}"`).join(", ")})`)
  const [profileRow] = await rows(profileSql("raw", names))
  const decisions = names.map((c, i) => decideColumn(c, readProfile(profileRow ?? {}, i)))
  await conn.run(`DROP TABLE IF EXISTS cleaned`)
  await conn.run(buildCleanTableSql("cleaned", "raw", decisions))
  const types = Object.fromEntries((await rows("DESCRIBE cleaned")).map((r) => [r["column_name"], r["column_type"]]))
  return { kinds: Object.fromEntries(decisions.map((d) => [d.name, d.kind])), types, data: await rows("SELECT * FROM cleaned") }
}

describe("load-time cleaning (real DuckDB)", () => {
  it("reads Turkish numbers with currency symbols exactly", async () => {
    const { kinds, data } = await clean({ tutar: ["1.250,50 TL", "₺ 999,99", "12.345.678", "-1.000,5", "0,75", "42"] })
    expect(kinds["tutar"]).toBe("tr-number")
    expect(data.map((r) => r["tutar"])).toEqual([1250.5, 999.99, 12345678, -1000.5, 0.75, 42])
  })

  it("treats an all-'1.250' column as Turkish thousands, not 1.25", async () => {
    const { kinds, data } = await clean({ fiyat: ["1.250", "2.500", "12.000"] })
    expect(kinds["fiyat"]).toBe("tr-number")
    expect(data.map((r) => r["fiyat"])).toEqual([1250, 2500, 12000])
  })

  it("keeps real dot decimals as decimals", async () => {
    const { kinds, data } = await clean({ oran: ["3.5", "1.250", "0.125", "10"] })
    expect(kinds["oran"]).toBe("decimal")
    expect(data.map((r) => r["oran"])).toEqual([3.5, 1.25, 0.125, 10])
  })

  it("reads US thousands separators", async () => {
    const { kinds, data } = await clean({ amount: ["$1,250.50", "12,345", "7.25"] })
    expect(kinds["amount"]).toBe("us-thousands")
    expect(data.map((r) => r["amount"])).toEqual([1250.5, 12345, 7.25])
  })

  it("parses day-first dates in any separator, and ISO dates", async () => {
    const { kinds, types, data } = await clean({
      tr: ["05.01.2025", "5/1/2025", "31-12-2025"],
      iso: ["2025-01-05", "2025/12/31", "2025.02.01"],
    })
    expect(kinds).toEqual({ tr: "dmy-date", iso: "iso-date" })
    expect(types).toEqual({ tr: "DATE", iso: "DATE" })
    expect(data.map((r) => r["tr"])).toEqual(["2025-01-05T00:00:00.000Z", "2025-01-05T00:00:00.000Z", "2025-12-31T00:00:00.000Z"])
    expect(data.map((r) => r["iso"])).toEqual(["2025-01-05T00:00:00.000Z", "2025-12-31T00:00:00.000Z", "2025-02-01T00:00:00.000Z"])
  })

  it("falls back to month-first only when day-first cannot parse", async () => {
    const { kinds, data } = await clean({ d: ["12/31/2025", "01/05/2025"] })
    expect(kinds["d"]).toBe("mdy-date")
    expect(data.map((r) => r["d"])).toEqual(["2025-12-31T00:00:00.000Z", "2025-01-05T00:00:00.000Z"])
  })

  it("keeps timestamps (with fractional seconds) as TIMESTAMP", async () => {
    const { types, data } = await clean({ t: ["05.01.2025 14:30", "2025-01-05 09:15:30.250"].slice(0, 1), u: ["2025-01-05 09:15:30.250"] })
    expect(types).toEqual({ t: "TIMESTAMP", u: "TIMESTAMP" })
    expect(data[0]).toEqual({ t: "2025-01-05T14:30:00.000Z", u: "2025-01-05T09:15:30.250Z" })
  })

  it("never converts when a single value does not fit", async () => {
    const { kinds, data } = await clean({ d: ["05.01.2025", "31.02.2025"], n: ["1.250,50", "yok değil"] })
    expect(kinds).toEqual({ d: "text", n: "text" })
    expect(data.map((r) => r["n"])).toEqual(["1.250,50", "yok değil"])
  })

  it("maps empty markers to NULL and keeps codes with leading zeros as text", async () => {
    const { kinds, data } = await clean({ v: ["1.250,5", "-", "", null, "N/A"], kod: ["00123", "04567", "1", null, null] })
    expect(kinds).toEqual({ v: "tr-number", kod: "text" })
    expect(data.map((r) => r["v"])).toEqual([1250.5, null, null, null, null])
    expect(data.map((r) => r["kod"])).toEqual(["00123", "04567", "1", null, null])
  })

  it("trims text and leaves Turkish text intact", async () => {
    const { kinds, data } = await clean({ sehir: [" İstanbul ", "İzmir"] })
    expect(kinds["sehir"]).toBe("text")
    expect(data.map((r) => r["sehir"])).toEqual(["İstanbul", "İzmir"])
  })
})

describe("excel-style midnight timestamps", () => {
  it("stay DATE when every time is 00:00:00", async () => {
    const { kinds, types } = await clean({ d: ["2025-01-05 00:00:00", "2025-02-01 00:00:00"] })
    expect(kinds["d"]).toBe("iso-date")
    expect(types["d"]).toBe("DATE")
  })
})

describe("exact money arithmetic", () => {
  it("sums 100k Turkish amounts to the exact cent", async () => {
    await conn.run(`CREATE OR REPLACE TABLE raw AS
      SELECT (CAST(1000 + (i * 7919) % 2500000 AS BIGINT) // 100)::VARCHAR || ',' || lpad(((1000 + (i * 7919) % 2500000) % 100)::VARCHAR, 2, '0') || ' TL' AS tutar,
             (1000 + (i * 7919) % 2500000) AS cents
      FROM range(100000) t(i)`)
    const [profileRow] = await rows(profileSql("raw", ["tutar"]))
    const decision = decideColumn("tutar", readProfile(profileRow ?? {}, 0))
    expect(decision.kind).toBe("tr-number")
    await conn.run("DROP TABLE IF EXISTS cleaned")
    await conn.run(buildCleanTableSql("cleaned", "raw", [decision]))
    const [expected] = await rows("SELECT SUM(cents) AS c FROM raw")
    const [got] = await rows("SELECT CAST(SUM(tutar) AS DOUBLE) AS s, CAST(SUM(tutar) * 100 AS HUGEINT) AS c FROM cleaned")
    expect(got?.["c"]).toBe(expected?.["c"])
    expect(String(got?.["s"])).toBe((Number(expected?.["c"]) / 100).toFixed(2).replace(/\.?0+$/, ""))
  })
})
