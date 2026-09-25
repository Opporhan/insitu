import { describe, expect, it } from "vitest"
import { buildInsight } from "@/lib/insight"
import { resolveView } from "@/lib/result-view"
import type { QueryPlan, ResultRow } from "@/lib/schema"

const n = (s: string) => s.replace(/[  ]/g, " ")

function insight(p: Partial<QueryPlan>, rows: ResultRow[]) {
  const plan: QueryPlan = {
    sql: "SELECT 1",
    chartType: "bar",
    xAxisKey: "k",
    yAxisKey: "v",
    seriesKey: "",
    title: "t",
    columns: [
      { key: "k", label: "Şehir", format: "text", total: false },
      { key: "v", label: "Ciro", format: "currency", total: false },
    ],
    ...p,
  }
  return n(buildInsight(resolveView(plan, rows, Object.keys(rows[0] ?? { k: 0, v: 0 }))))
}

describe("buildInsight", () => {
  it("bar: max/min regardless of sort order, exact difference", () => {
    const text = insight({}, [{ k: "Konya", v: 100 }, { k: "İstanbul", v: 250 }])
    expect(text).toBe("En yüksek: İstanbul (₺250); en düşük: Konya (₺100). En yüksek değer, en düşükten %150 fazla.")
  })

  it("bar: no percentage when the minimum is zero", () => {
    expect(insight({}, [{ k: "A", v: 0 }, { k: "B", v: 10 }])).not.toContain("fazla")
  })

  it("line: first→last change and peak", () => {
    const text = insight(
      { chartType: "line", columns: [{ key: "k", label: "Ay", format: "month", total: false }, { key: "v", label: "Ciro", format: "currency", total: false }] },
      [{ k: "2026-01", v: 200 }, { k: "2026-02", v: 500 }, { k: "2026-03", v: 300 }],
    )
    expect(text).toBe("Ocak 2026 → Mart 2026: ₺200 → ₺300 (+%50). Zirve: Şubat 2026 (₺500).")
  })

  it("line: no percentage from a zero base", () => {
    expect(insight({ chartType: "line" }, [{ k: "a", v: 0 }, { k: "b", v: 5 }])).not.toContain("%")
  })

  it("pie: largest share of the total", () => {
    expect(insight({ chartType: "pie" }, [{ k: "Kart", v: 75 }, { k: "Havale", v: 25 }])).toBe(
      '"Kart", %75 ile en büyük paya sahip (₺75). Toplam: ₺100.',
    )
  })

  it("metric: every value with its label", () => {
    expect(
      insight(
        { chartType: "metric", columns: [{ key: "t", label: "Toplam Ciro", format: "currency", total: false }, { key: "o", label: "Oran", format: "percent", total: false }] },
        [{ t: 1500.5, o: 12.34 }],
      ),
    ).toBe("Toplam Ciro: ₺1.500,50 · Oran: %12,3.")
  })

  it("empty result", () => {
    expect(insight({}, [])).toBe("Bu soruya uyan kayıt bulunamadı.")
  })
})

describe("buildInsight extras", () => {
  it("cumulative lines report the reached total, not a growth percentage", () => {
    const text = insight(
      {
        chartType: "line",
        yAxisKey: "kumulatif_ciro",
        columns: [
          { key: "k", label: "Tarih", format: "date", total: false },
          { key: "kumulatif_ciro", label: "Kümülatif Ciro", format: "currency", total: false },
        ],
      },
      [{ k: "2026-01-01", kumulatif_ciro: 10 }, { k: "2026-01-02", kumulatif_ciro: 25 }],
    )
    expect(text).toBe("Kümülatif toplam 2 Oca 2026 itibarıyla ₺25 seviyesine ulaştı.")
  })

  it("table insight includes totals of summable columns", () => {
    const text = insight(
      {
        chartType: "table",
        columns: [
          { key: "k", label: "Sipariş", format: "text", total: false },
          { key: "v", label: "Tutar", format: "currency", total: true },
        ],
      },
      [{ k: "S1", v: 1000.25 }, { k: "S2", v: 499.75 }],
    )
    expect(text).toBe("2 satırlık sonuç bulundu. Toplam tutar (listelenen 2 satır): ₺1.500.")
  })
})

describe("bar totals", () => {
  const cols = (total: boolean) => [
    { key: "k", label: "Şehir", format: "text" as const, total: false },
    { key: "v", label: "Ciro", format: "currency" as const, total },
  ]
  it("adds the sum of shown bars for summable measures", () => {
    expect(insight({ columns: cols(true) }, [{ k: "İstanbul", v: 1234234 }, { k: "Ankara", v: 580596 }])).toBe(
      "En yüksek: İstanbul (₺1.234.234); en düşük: Ankara (₺580.596). En yüksek değer, en düşükten %112,6 fazla. Gösterilen 2 kalemin toplamı: ₺1.814.830.",
    )
  })
  it("never sums prices or averages", () => {
    expect(insight({ columns: cols(false) }, [{ k: "a", v: 1 }, { k: "b", v: 2 }])).not.toContain("toplam")
  })
})

describe("incomplete last period", () => {
  const month = { chartType: "line" as const, columns: [{ key: "k", label: "Ay", format: "month" as const, total: false }, { key: "v", label: "Ciro", format: "currency" as const, total: true }] }
  it("compares against the last full period and says why", () => {
    expect(insight(month, [{ k: "2025-09", v: 100 }, { k: "2025-10", v: 110 }, { k: "2025-11", v: 120 }, { k: "2025-12", v: 3 }])).toBe(
      "Eylül 2025 → Kasım 2025: ₺100 → ₺120 (+%20). Zirve: Kasım 2025 (₺120). Son dönem (Aralık 2025: ₺3) diğerlerinden belirgin düşük; dönem henüz tamamlanmamış olabilir, bu yüzden karşılaştırma Kasım 2025 ile yapıldı.",
    )
  })
  it("reports a real decline normally", () => {
    expect(insight(month, [{ k: "a", v: 100 }, { k: "b", v: 90 }, { k: "c", v: 80 }, { k: "d", v: 70 }])).toBe(
      "a → d: ₺100 → ₺70 (−%30). Zirve: a (₺100).",
    )
  })
})

describe("buildInsight (English)", () => {
  it("writes the same facts in English", async () => {
    const { buildInsight: build } = await import("@/lib/insight")
    const { resolveView: resolve } = await import("@/lib/result-view")
    const plan = {
      sql: "SELECT 1",
      chartType: "bar" as const,
      xAxisKey: "k",
      yAxisKey: "v",
      seriesKey: "",
      title: "t",
      columns: [
        { key: "k", label: "City", format: "text" as const, total: false },
        { key: "v", label: "Revenue", format: "currency" as const, total: true },
      ],
    }
    const view = resolve(plan, [{ k: "Istanbul", v: 1234234 }, { k: "Ankara", v: 580596 }], ["k", "v"])
    expect(n(build(view, "en"))).toBe(
      "Highest: Istanbul (₺1,234,234); lowest: Ankara (₺580,596). The highest is 112.6% above the lowest. Sum of the 2 items shown: ₺1,814,830.",
    )
  })
})
