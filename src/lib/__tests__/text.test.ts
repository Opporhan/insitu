import { describe, expect, it } from "vitest"
import { messages } from "@/lib/i18n"
import { suggestQuestions } from "@/lib/suggestions"
import { dedupeAdjacentWords, hasTotalWord } from "@/lib/text"
import { toPlan } from "@/lib/translator/gemini"

describe("no doubled 'toplam' / 'total'", () => {
  it("detects the word anywhere in a label", () => {
    for (const s of ["Toplam Ciro", "toplam_adet", "Satış Toplamı", "Genel Toplam", "Total Revenue", "sales total", "Toplamlar"]) expect(hasTotalWord(s)).toBe(true)
    for (const s of ["Tutar", "Ciro", "Adet", "Totem"]) expect(hasTotalWord(s)).toBe(false)
  })

  it("table insight never says 'Toplam toplam' or 'Toplam satış toplamı'", () => {
    const tr = messages.tr.insight.tableTotal
    expect(tr("Toplam Ciro", "2", "₺5")).toBe("Toplam Ciro (2 satır): ₺5")
    expect(tr("Satış Toplamı", "2", "₺5")).toBe("Satış Toplamı (2 satır): ₺5")
    expect(tr("Adet", "2", "5")).toBe("Toplam Adet (2 satır): 5")
    expect(messages.en.insight.tableTotal("Total Revenue", "2", "₺5")).toBe("Total Revenue (2 rows): ₺5")
  })

  it("suggestions keep one 'Toplam' whatever the measure is called", () => {
    const cols = (measure: string) => [
      { name: "sehir", type: "text" as const },
      { name: "tarih", type: "date" as const },
      { name: measure, type: "number" as const },
    ]
    const all = [
      ...suggestQuestions(cols("toplam_ciro"), "tr"),
      ...suggestQuestions(cols("satis_toplami"), "tr", new Map([["satis_toplami", "Satış Toplamı"]])),
      ...suggestQuestions(cols("genel_toplam"), "tr", new Map([["genel_toplam", "Genel Toplam"]])),
      ...suggestQuestions(cols("total_revenue"), "en"),
    ]
    for (const q of all) expect(q).not.toMatch(/\b(toplam|total)\b.*\b(toplam|total)\b/i)
    expect(all[0]).toBe("Toplam ciro en yüksek olan şehir hangisi?")
    expect(all[3]).toBe("Satış toplamı en yüksek olan şehir hangisi?")
  })

  it("collapses repeated words in generated titles/labels only", () => {
    expect(dedupeAdjacentWords("Toplam Toplam Ciro")).toBe("Toplam Ciro")
    expect(dedupeAdjacentWords("toplam  TOPLAM adet")).toBe("toplam adet")
    expect(dedupeAdjacentWords("Şehir Bazında Ciro")).toBe("Şehir Bazında Ciro")
    const plan = toPlan({
      sql: "SELECT 1 AS a",
      chartType: "metric",
      xAxisKey: "",
      yAxisKey: "",
      seriesKey: "",
      title: "Toplam Toplam Ciro",
      explanation: "",
      note: "",
      columns: [{ key: "a", label: "Toplam toplam ciro", format: "currency", total: true }],
    })
    expect(plan.success && plan.data.title).toBe("Toplam Ciro")
    expect(plan.success && plan.data.columns[0]?.label).toBe("Toplam ciro")
  })
})
