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
  it("uses Turkish Excel conventions and rounds money to the cent", () => {
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
    expect(csv).toBe('Şehir;Ciro\r\nİstanbul;1234567,89\r\n"A;""B""";')
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

describe("CSV export safety and precision", () => {
  const cols = [
    { key: "k", label: "Ad", format: "text" as const, total: false },
    { key: "m", label: "Ciro", format: "currency" as const, total: true },
    { key: "a", label: "Ortalama", format: "number" as const, total: false },
    { key: "n", label: "Adet", format: "integer" as const, total: true },
    { key: "p", label: "Pay", format: "percent" as const, total: false },
  ]
  it("rounds money to the cent and keeps other formats readable", () => {
    expect(toCsv(cols, [{ k: "x", m: 3965.1034482759, a: 2.3342989571, n: 1726, p: 51.946186157 }])).toBe(
      "Ad;Ciro;Ortalama;Adet;Pay\r\nx;3965,1;2,3343;1726;51,95",
    )
  })
  it("neutralizes cells a spreadsheet would run as formulas", () => {
    const csv = toCsv(cols.slice(0, 1), [{ k: "=HYPERLINK(1)" }, { k: "+1" }, { k: "-x" }, { k: "@a" }, { k: "Normal" }])
    expect(csv.split("\r\n").slice(1)).toEqual(["'=HYPERLINK(1)", "'+1", "'-x", "'@a", "Normal"])
  })
  it("never touches real numbers, including negatives", () => {
    expect(toCsv(cols.slice(1, 2), [{ m: -450.5 }]).split("\r\n")[1]).toBe("-450,5")
  })
})

describe("chunked CSV builder", () => {
  it("produces exactly the same text as the synchronous one across chunk boundaries", async () => {
    const { toDelimitedAsync } = await import("@/lib/export")
    const cols = [
      { key: "k", label: "Ad", format: "text" as const, total: false },
      { key: "v", label: "Tutar", format: "currency" as const, total: true },
    ]
    const rows = Array.from({ length: 12_345 }, (_, i) => ({ k: i % 7 === 0 ? `=x${i}` : `ü;${i}`, v: i * 1.005 }))
    expect(await toDelimitedAsync(cols, rows, ";", "tr")).toBe(toCsv(cols, rows, "tr"))
  })
})
