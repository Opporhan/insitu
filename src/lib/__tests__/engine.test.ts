import { describe, expect, it } from "vitest"
import { normalizeSql, repairableError } from "@/lib/engine/normalize"
import { toCsv } from "@/lib/export"

describe("normalizeSql", () => {
  it("casts numbers to DOUBLE and dates to text, keeping column names", () => {
    const res = normalizeSql("SELECT 1", [
      { name: "toplam", type: "DECIMAL(18,2)" },
      { name: "gün", type: "DATE" },
      { name: "şehir", type: "VARCHAR" },
      { name: "n", type: "BIGINT" },
    ])
    expect(res).toEqual({
      ok: true,
      sql: `SELECT CAST(q."toplam" AS DOUBLE) AS "toplam", strftime(q."gün", '%Y-%m-%d') AS "gün", q."şehir" AS "şehir", CAST(q."n" AS DOUBLE) AS "n" FROM (SELECT 1) AS q`,
    })
  })

  it("rejects duplicate output names", () => {
    expect(normalizeSql("SELECT 1", [{ name: "a", type: "INTEGER" }, { name: "a", type: "INTEGER" }]).ok).toBe(false)
  })
})

describe("repairableError", () => {
  it("passes structural errors with literals masked", () => {
    expect(repairableError(`Binder Error: Referenced column "sehirr" not found in FROM clause! Candidate bindings: "sehir"`)).toContain("sehirr")
    expect(repairableError(`Parser Error: syntax error at or near 'İzmir'`)).toBe("Parser Error: syntax error at or near '…'")
  })

  it("never forwards data-dependent errors", () => {
    expect(repairableError("Conversion Error: Could not convert string 'Ahmet Yılmaz' to INT32")).toBeNull()
    expect(repairableError("Out of Range Error: 123456 is out of range")).toBeNull()
  })
})

describe("toCsv", () => {
  it("uses Turkish Excel conventions without losing precision", () => {
    const csv = toCsv(
      [
        { key: "k", label: "Şehir", format: "text", total: false },
        { key: "v", label: "Ciro", format: "currency", total: false },
      ],
      [
        { k: "İstanbul", v: 1234567.891 },
        { k: 'A;"B"', v: null },
      ],
    )
    expect(csv).toBe('Şehir;Ciro\r\nİstanbul;1234567,891\r\n"A;""B""";')
  })
})

describe("toTsv", () => {
  it("tab-separates for spreadsheet pasting", async () => {
    const { toTsv } = await import("@/lib/export")
    expect(
      toTsv(
        [
          { key: "k", label: "Şehir", format: "text", total: false },
          { key: "v", label: "Ciro", format: "currency", total: true },
        ],
        [{ k: "İstanbul", v: 1250.5 }],
      ),
    ).toBe("Şehir\tCiro\r\nİstanbul\t1250,5")
  })
})
