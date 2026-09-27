import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api"
import { beforeAll, describe, expect, it } from "vitest"
import { buildCleanTableSql, decideColumn, profileColumns } from "@/lib/engine/clean"

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
  const profiles = await profileColumns(async (sql) => (await rows(sql))[0] ?? {}, "raw", names)
  const decisions = names.map((c, i) => decideColumn(c, profiles[i]!))
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

  it("keeps a mostly-numeric column with an unreadable value as text and counts the blockers", async () => {
    const names = ["tutar"]
    await conn.run(
      `CREATE OR REPLACE TABLE raw AS SELECT * FROM (VALUES ('12,50'), ('1.015,85'), ('12:175)50'), ('90,20'), ('5.129,50'), ('6')) t(tutar)`,
    )
    const [profile] = await profileColumns(async (sql) => (await rows(sql))[0] ?? {}, "raw", names)
    const d = decideColumn("tutar", profile!)
    expect(d.kind).toBe("text")
    expect(d.unreadable).toBe(1)
    // Plain text columns are not flagged.
    await conn.run(`CREATE OR REPLACE TABLE raw AS SELECT * FROM (VALUES ('Kadıköy'), ('Beşiktaş'), ('3'), ('Şişli'), ('Bornova')) t(ilce)`)
    const [text] = await profileColumns(async (sql) => (await rows(sql))[0] ?? {}, "raw", ["ilce"])
    expect(decideColumn("ilce", text!).unreadable).toBe(0)
  })

  it("reads accounting negatives: (1.250,50), 1.250,50- and the Unicode minus", async () => {
    const { kinds, data } = await clean({ tutar: ["(1.250,50)", "1.250,50-", "−99,90", "10,00", "₺ (5,00)"] })
    expect(kinds["tutar"]).toBe("tr-number")
    expect(data.map((r) => r["tutar"])).toEqual([-1250.5, -1250.5, -99.9, 10, -5])
  })

  it("never guesses between 1,250 = 1.25 and 1,250 = 1250", async () => {
    const amb = await clean({ miktar: ["1,250", "2,500", "12,000"] })
    expect(amb.kinds["miktar"]).toBe("text")
    // Any value that settles it decides the column.
    expect((await clean({ m: ["1,250", "2,5", "3,75"] })).data.map((r) => r["m"])).toEqual([1.25, 2.5, 3.75])
    expect((await clean({ m: ["1,250", "1,250,000"] })).data.map((r) => r["m"])).toEqual([1250, 1250000])
  })

  it("keeps numbers longer than 18 digits (card numbers, long IDs) as text", async () => {
    const { kinds } = await clean({ kart: ["12345678901234567890", "98765432109876543210"] })
    expect(kinds["kart"]).toBe("text")
  })

  it("treats Excel error values as empty", async () => {
    const { kinds, data } = await clean({ oran: ["#DIV/0!", "#DEĞER!", "12", "#SAYI/0!"] })
    expect(kinds["oran"]).toBe("integer")
    expect(data.map((r) => r["oran"])).toEqual([null, null, 12, null])
  })

  it("reads ISO timestamps with T and a zone as written (no time-zone shift)", async () => {
    const { kinds, data } = await clean({ t: ["2025-01-05T10:30:00Z", "2025-02-06T08:00:00+03:00", "2025-03-07T23:59:59.250Z"] })
    expect(kinds["t"]).toBe("iso-date")
    expect(data.map((r) => r["t"])).toEqual(["2025-01-05T10:30:00.000Z", "2025-02-06T08:00:00.000Z", "2025-03-07T23:59:59.250Z"])
  })

  it("reads year-month values as the first day of the month, but not decimals", async () => {
    expect((await clean({ ay: ["2025-01", "2025-02", "2025/03"] })).data.map((r) => r["ay"])).toEqual([
      "2025-01-01T00:00:00.000Z",
      "2025-02-01T00:00:00.000Z",
      "2025-03-01T00:00:00.000Z",
    ])
    expect((await clean({ oran: ["2024.5", "2023.7", "2022.1"] })).kinds["oran"]).toBe("decimal")
  })

  it("reads Turkish and English month names and two-digit years", async () => {
    const named = await clean({ t: ["5 Ocak 2025", "12 Şubat 2025", "3 AĞUSTOS 2025", "1 EKİM 2025", "20 Kas. 2025 14:30", "January 7, 2025"] })
    expect(named.kinds["t"]).toBe("dmy-date")
    expect(named.data.map((r) => String(r["t"]).slice(0, 16))).toEqual([
      "2025-01-05T00:00",
      "2025-02-12T00:00",
      "2025-08-03T00:00",
      "2025-10-01T00:00",
      "2025-11-20T14:30",
      "2025-01-07T00:00",
    ])
    const short = await clean({ t: ["05.01.25", "31.12.24"] })
    expect(short.data.map((r) => String(r["t"]).slice(0, 10))).toEqual(["2025-01-05", "2024-12-31"])
    // Version numbers are not dates.
    expect((await clean({ v: ["1.2.3", "1.10.2", "2.0.1"] })).kinds["v"]).toBe("text")
  })

  it("reads fractions of a second and AM/PM times", async () => {
    const { data } = await clean({ t: ["05.01.2025 14:30:15.250", "06.01.2025 2:05 PM", "07.01.2025 9:00 am"] })
    expect(data.map((r) => String(r["t"]).slice(0, 23))).toEqual(["2025-01-05T14:30:15.250", "2025-01-06T14:05:00.000", "2025-01-07T09:00:00.000"])
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
    const [profile] = await profileColumns(async (sql) => (await rows(sql))[0] ?? {}, "raw", ["tutar"])
    const decision = decideColumn("tutar", profile!)
    expect(decision.kind).toBe("tr-number")
    await conn.run("DROP TABLE IF EXISTS cleaned")
    await conn.run(buildCleanTableSql("cleaned", "raw", [decision]))
    const [expected] = await rows("SELECT SUM(cents) AS c FROM raw")
    const [got] = await rows("SELECT CAST(SUM(tutar) AS DOUBLE) AS s, CAST(SUM(tutar) * 100 AS HUGEINT) AS c FROM cleaned")
    expect(got?.["c"]).toBe(expected?.["c"])
    expect(String(got?.["s"])).toBe((Number(expected?.["c"]) / 100).toFixed(2).replace(/\.?0+$/, ""))
  })
})
