import { DuckDBInstance } from "@duckdb/node-api"
import { describe, expect, it } from "vitest"
import { profileTable } from "@/lib/engine/column-profile"

describe("profileTable (real DuckDB)", () => {
  it("summarizes filled share, distinct values, ranges and top values", async () => {
    const conn = await (await DuckDBInstance.create(":memory:")).connect()
    await conn.run(`CREATE TABLE data AS SELECT * FROM (VALUES
      ('İstanbul', 100.5::DECIMAL(10,2), DATE '2025-01-05'),
      ('İstanbul', 20.0, DATE '2025-03-01'),
      ('Ankara', NULL, DATE '2025-02-10'),
      (NULL, 5.25, NULL)) t(sehir, tutar, tarih)`)
    const query = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJS() as Record<string, unknown>[]
    const [sehir, tutar, tarih] = await profileTable(query, "data", [
      { name: "sehir", type: "text" },
      { name: "tutar", type: "number" },
      { name: "tarih", type: "date" },
    ])
    expect(sehir).toMatchObject({ filled: 3, distinct: 2, top: [{ value: "İstanbul", count: 2 }, { value: "Ankara", count: 1 }] })
    expect(tutar).toMatchObject({ filled: 3, min: 5.25, max: 100.5 })
    expect(tarih).toMatchObject({ filled: 3, min: "2025-01-05 00:00", max: "2025-03-01 00:00" })
  })
})
