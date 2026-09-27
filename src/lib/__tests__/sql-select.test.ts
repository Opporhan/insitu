import { describe, expect, it } from "vitest"
import { inferFormat, knownFormats, selectItems } from "@/lib/sql-select"

describe("selectItems", () => {
  it("does not invent a name for an unnamed expression", () => {
    expect(selectItems(`SELECT CASE WHEN "a" > 1 THEN 'x' ELSE 'y' END FROM data`)[0]?.alias).toMatch(/^CASE/)
    expect(selectItems(`SELECT "a" + "b" FROM data`)[0]?.alias).toBe(`"a" + "b"`)
  })

  it("reads the outermost SELECT list, skipping CTEs, nested calls and quoted commas", () => {
    const sql = `WITH t AS (SELECT a, b FROM data) SELECT "sehir", SUM("tutar") AS ciro, round(avg("fiyat"), 2) AS "ort, fiyat", count(*) n FROM t GROUP BY 1`
    expect(selectItems(sql).map((i) => [i.alias, i.sources])).toEqual([
      ["sehir", ["sehir"]],
      ["ciro", ["tutar"]],
      ["ort, fiyat", ["fiyat"]],
      ["n", []],
    ])
  })
})

describe("inferFormat", () => {
  const known = knownFormats(`SELECT "kategori", SUM("tutar") AS toplam_ciro, SUM("adet") AS toplam_adet FROM data GROUP BY 1`, [
    { key: "kategori", format: "text" },
    { key: "toplam_ciro", format: "currency" },
    { key: "toplam_adet", format: "integer" },
  ])
  const infer = (sql: string) => {
    const items = selectItems(sql)
    return items.map((i) => inferFormat(i, known))
  }

  it("inherits the format from the earlier plan's source column", () => {
    expect(infer(`SELECT SUM("tutar") AS ciro, AVG("adet") AS ort FROM data`)).toEqual([
      { format: "currency", total: true },
      { format: "number", total: false },
    ])
  })

  it("falls back to clear money names, never to quantities; COUNT is a whole number", () => {
    const empty = new Map()
    const f = (sql: string) => selectItems(sql).map((i) => inferFormat(i, empty))
    expect(f(`SELECT SUM("birim_fiyat") AS x, SUM("toplam_adet") AS y, count(*) AS n, MAX("bakiye") AS m FROM data`)).toEqual([
      { format: "currency", total: true },
      null,
      { format: "integer", total: true },
      { format: "currency", total: false },
    ])
  })
})
