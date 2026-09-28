import { describe, expect, it } from "vitest"
import { tableNameFor } from "@/lib/engine/load-file"
import { joinSuggestion } from "@/lib/suggestions"

describe("tableNameFor", () => {
  it("makes safe, unique table names from file (and sheet) names", () => {
    expect(tableNameFor("Hedefler 2026.xlsx", ["data"])).toBe("hedefler_2026")
    expect(tableNameFor("hedefler.csv", ["data", "hedefler"])).toBe("hedefler_2")
    expect(tableNameFor("data.csv", ["data"])).toBe("data_tablo")
    expect(tableNameFor("Order.csv", ["data"])).toBe("order_tablo")
    expect(tableNameFor("2026.csv", ["data"])).toBe("tablo_2026")
    expect(tableNameFor("rapor.xlsx", ["data"], "Şube Hedefleri")).toBe("rapor_sube_hedefleri")
  })
})

describe("joinSuggestion", () => {
  const sales = [
    { name: "sehir", type: "text" as const },
    { name: "tutar", type: "number" as const },
  ]
  it("compares a measure of each table over their shared key", () => {
    const targets = { columns: [{ name: "sehir", type: "text" as const }, { name: "hedef_tl", type: "number" as const }], originals: new Map([["hedef_tl", "Hedef (TL)"]]) }
    expect(joinSuggestion(sales, [targets], "tr")).toBe("Şehir bazında toplam tutar ve toplam hedef karşılaştırması")
  })
  it("is readable in English too", () => {
    const targets = { columns: [{ name: "sehir", type: "text" as const }, { name: "hedef_tl", type: "number" as const }], originals: new Map([["hedef_tl", "Hedef (TL)"]]) }
    expect(joinSuggestion(sales, [targets], "en")).toBe("Compare total amount and total target by city")
  })

  it("offers nothing without a shared key", () => {
    const staff = { columns: [{ name: "ad", type: "text" as const }, { name: "maas", type: "number" as const }], originals: new Map() }
    expect(joinSuggestion(sales, [staff], "tr")).toBeNull()
  })
})
