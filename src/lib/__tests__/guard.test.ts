import { describe, expect, it } from "vitest"
import { guardSql } from "@/lib/engine/guard"
import { strictNumericCasts } from "@/lib/engine/normalize"

describe("guardSql", () => {
  it.each([
    "SELECT label, value FROM data",
    "WITH a AS (SELECT 1 AS x) SELECT x FROM a;",
    `SELECT "update_date" AS label, 1 AS value FROM data`,
    // Real column names and values that contain SQL words, semicolons or dashes.
    `SELECT "export", "import", "set", "load" FROM data`,
    `SELECT count(*) FROM data WHERE "kategori" = 'Call Center' OR "kod" = 'A--B;C'`,
    `SELECT "ad" FROM data WHERE "ad" = 'O''Neil'`,
  ])("accepts %s", (sql) => {
    expect(guardSql(sql).ok).toBe(true)
  })

  it.each([
    "DROP TABLE data",
    "SELECT 1; DROP TABLE data",
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM data -- hidden",
    "ATTACH 'x.db'",
    "COPY data TO 'out.csv'",
    "INSTALL httpfs",
    "SET enable_external_access = true",
    "SELECT * FROM glob('*')",
    `SELECT * FROM "read_csv"('/etc/passwd')`,
    "SELECT * FROM read_xlsx('x.xlsx')",
    "SELECT * FROM sqlite_scan('x.db', 't')",
    "SELECT * FROM query('SELECT 1')",
    "SELECT getenv('HOME')",
    "SELECT 'x' FROM data; DROP TABLE data",
    "SELECT 'unterminated FROM data; DROP TABLE data",
  ])("rejects %s", (sql) => {
    expect(guardSql(sql).ok).toBe(false)
  })
})

describe("strictNumericCasts", () => {
  it("makes numeric TRY_CASTs inside aggregates strict; leaves listings, dates and strings alone", () => {
    expect(strictNumericCasts(`SELECT SUM(TRY_CAST("tutar" AS DOUBLE)) FROM data`)).toBe(`SELECT SUM(CAST("tutar" AS DOUBLE)) FROM data`)
    expect(strictNumericCasts(`SELECT sum(try_cast(replace("t", ',', '.') AS DECIMAL(18, 2))) FROM data`)).toBe(
      `SELECT sum(CAST(replace("t", ',', '.') AS DECIMAL(18, 2))) FROM data`,
    )
    const date = `SELECT strftime(TRY_CAST("tarih" AS DATE), '%Y') AS y FROM data WHERE "ad" = 'TRY_CAST(x AS INT)'`
    expect(strictNumericCasts(date)).toBe(date)
    // Listing rows: a NULL shows as "—", nothing is summed, so the cast stays tolerant.
    const listing = `SELECT "urun", TRY_CAST("adet" AS INTEGER) AS adet FROM data ORDER BY TRY_CAST("adet" AS INTEGER)`
    expect(strictNumericCasts(listing)).toBe(listing)
    expect(strictNumericCasts(`SELECT "il", AVG(1.0 * TRY_CAST("adet" AS INTEGER)) FROM data GROUP BY 1`)).toBe(
      `SELECT "il", AVG(1.0 * CAST("adet" AS INTEGER)) FROM data GROUP BY 1`,
    )
  })
})
