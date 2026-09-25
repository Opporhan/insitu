import { describe, expect, it } from "vitest"
import { suggestQuestions } from "@/lib/suggestions"

describe("suggestQuestions", () => {
  it("skips identifier columns and prefers money measures", () => {
    expect(
      suggestQuestions([
        { name: "Sipariş No", type: "text" },
        { name: "Tarih", type: "date" },
        { name: "Şehir", type: "text" },
        { name: "Adet", type: "number" },
        { name: "Tutar", type: "number" },
      ]),
    ).toEqual(["En yüksek Tutar değerine sahip ilk 5 Şehir", "Aylık Tutar trendi", "Şehir bazında Tutar dağılımı"])
  })
})

describe("suggestQuestions measure choice", () => {
  it("prefers an amount column over a unit price", () => {
    const [first] = suggestQuestions([
      { name: "sehir", type: "text" },
      { name: "birim_fiyat", type: "number" },
      { name: "tutar", type: "number" },
    ])
    expect(first).toBe("En yüksek tutar değerine sahip ilk 5 sehir")
  })
})
