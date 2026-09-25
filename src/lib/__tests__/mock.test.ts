import { describe, expect, it } from "vitest"
import type { Column } from "@/lib/schema"
import { planQuery } from "@/lib/translator/mock"

const columns: Column[] = [
  { name: "tarih", type: "date" },
  { name: "urun_adi", type: "text" },
  { name: "bolge", type: "text" },
  { name: "adet", type: "number" },
  { name: "fiyat", type: "number" },
]

function plan(question: string, cols: Column[] = columns) {
  const res = planQuery({ question, columns: cols })
  if (!res.ok) throw new Error(res.error)
  return res.plan
}

describe("mock translator", () => {
  it("top N earners this month → bar over price × quantity", () => {
    const p = plan("Bu ay en çok kazandıran ilk 3 ürünü göster")
    expect(p.chartType).toBe("bar")
    expect(p.columns).toEqual([
      { key: "label", label: "urun_adi", format: "text", total: false },
      { key: "value", label: "toplam fiyat × adet", format: "currency", total: true },
    ])
    expect(p.sql).toContain(`SUM("fiyat" * "adet")`)
    expect(p.sql).toContain("LIMIT 3")
    expect(p.sql).toContain(`date_trunc('month', "tarih")`)
  })

  it("monthly trend → line grouped by month", () => {
    const p = plan("Aylık adet trendi")
    expect(p.chartType).toBe("line")
    expect(p.columns[0]?.format).toBe("month")
    expect(p.sql).toContain(`strftime(date_trunc('month', "tarih"), '%Y-%m')`)
    expect(p.sql).toContain(`SUM("adet")`)
  })

  it("distribution → pie on the mentioned dimension, all groups returned", () => {
    const p = plan("Bölge bazında adet dağılımı")
    expect(p.chartType).toBe("pie")
    expect(p.columns[0]?.label).toBe("bolge")
    expect(p.sql).not.toContain("LIMIT")
  })

  it("'en az' sorts ascending", () => {
    expect(plan("En az satan 5 ürün adet").sql).toContain("ORDER BY value ASC")
  })

  it("falls back to COUNT(*) when there is no numeric column", () => {
    expect(plan("Ürün sayısı", [{ name: "urun", type: "text" }]).sql).toContain("COUNT(*)")
  })

  it("fails with suggestions when nothing can be grouped", () => {
    const res = planQuery({ question: "toplam", columns: [{ name: "adet", type: "number" }] })
    expect(res.ok).toBe(false)
  })

  it("quotes identifiers safely", () => {
    const p = plan("ilk 2", [
      { name: 'ad"; DROP TABLE data; --', type: "text" },
      { name: "adet", type: "number" },
    ])
    expect(p.sql).toContain(`"ad""; DROP TABLE data; --"`)
  })
})
