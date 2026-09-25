import { describe, expect, it } from "vitest"
import { MAX_PIE_SLICES, resolveView } from "@/lib/result-view"
import type { QueryPlan, ResultRow } from "@/lib/schema"

function plan(p: Partial<QueryPlan>): QueryPlan {
  return {
    sql: "SELECT 1",
    chartType: "bar",
    xAxisKey: "k",
    yAxisKey: "v",
    seriesKey: "",
    title: "t",
    columns: [
      { key: "k", label: "Kategori", format: "text", total: false },
      { key: "v", label: "Ciro", format: "currency", total: false },
    ],
    ...p,
  }
}
const keys = (rows: ResultRow[]) => Object.keys(rows[0] ?? {})

describe("resolveView", () => {
  it("returns empty for no rows", () => {
    expect(resolveView(plan({}), [], ["k", "v"]).kind).toBe("empty")
  })

  it("keeps SQL order for bars", () => {
    const rows = [{ k: "B", v: 5 }, { k: "A", v: 9 }]
    const view = resolveView(plan({}), rows, keys(rows))
    expect(view.kind).toBe("bar")
    if (view.kind === "bar") expect(view.data.map((d) => d.x)).toEqual(["B", "A"])
  })

  it("falls back to a table when a category repeats (not aggregated)", () => {
    const rows = [{ k: "A", v: 1 }, { k: "A", v: 2 }]
    expect(resolveView(plan({}), rows, keys(rows)).kind).toBe("table")
  })

  it("falls back to a table when the y axis is not numeric", () => {
    const rows = [{ k: "A", v: "x" }]
    expect(resolveView(plan({}), rows, keys(rows)).kind).toBe("table")
  })

  it("falls back to a table when axis keys are missing", () => {
    const rows = [{ k: "A", v: 1 }]
    expect(resolveView(plan({ xAxisKey: "nope" }), rows, keys(rows)).kind).toBe("table")
  })

  it("metric needs exactly one row", () => {
    expect(resolveView(plan({ chartType: "metric" }), [{ k: "A", v: 1 }], ["k", "v"]).kind).toBe("metric")
    expect(resolveView(plan({ chartType: "metric" }), [{ k: "A", v: 1 }, { k: "B", v: 2 }], ["k", "v"]).kind).toBe("table")
  })

  it("pivots long-format series and orders series by total", () => {
    const rows = [
      { m: "2026-01", c: "Giyim", v: 10 },
      { m: "2026-01", c: "Elektronik", v: 50 },
      { m: "2026-02", c: "Elektronik", v: 70 },
    ]
    const p = plan({
      chartType: "line",
      xAxisKey: "m",
      yAxisKey: "v",
      seriesKey: "c",
      columns: [
        { key: "m", label: "Ay", format: "month", total: false },
        { key: "c", label: "Kategori", format: "text", total: false },
        { key: "v", label: "Ciro", format: "currency", total: false },
      ],
    })
    const view = resolveView(p, rows, ["m", "c", "v"])
    expect(view.kind).toBe("line")
    if (view.kind !== "line") return
    expect(view.series.map((s) => s.label)).toEqual(["Elektronik", "Giyim"])
    expect(view.data).toEqual([
      { x: "2026-01", s0: 50, s1: 10 },
      { x: "2026-02", s0: 70, s1: null },
    ])
  })

  it("sorts date-like line x values chronologically", () => {
    const rows = [{ k: "2026-03", v: 1 }, { k: "2026-01", v: 2 }]
    const view = resolveView(plan({ chartType: "line" }), rows, keys(rows))
    if (view.kind === "line") expect(view.data.map((d) => d.x)).toEqual(["2026-01", "2026-03"])
  })

  it("computes exact pie shares and folds extra slices into 'Diğer' preserving the total", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ k: `c${i}`, v: 10 - i }))
    const view = resolveView(plan({ chartType: "pie" }), rows, keys(rows))
    expect(view.kind).toBe("pie")
    if (view.kind !== "pie") return
    expect(view.slices).toHaveLength(MAX_PIE_SLICES)
    expect(view.total).toBe(55)
    expect(view.slices.at(-1)).toMatchObject({ name: "Diğer", value: 4 + 3 + 2 + 1 })
    expect(view.slices.reduce((s, x) => s + x.value, 0)).toBe(55)
    expect(view.slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 12)
  })

  it("rejects negative pie values", () => {
    const rows = [{ k: "A", v: 5 }, { k: "B", v: -1 }]
    expect(resolveView(plan({ chartType: "pie" }), rows, keys(rows)).kind).toBe("table")
  })

  it("corrects a declared numeric format on text values", () => {
    const rows = [{ k: "A", v: 1 }]
    const view = resolveView(
      plan({ chartType: "table", columns: [{ key: "k", label: "K", format: "currency", total: false }, { key: "v", label: "V", format: "text", total: false }] }),
      rows,
      keys(rows),
    )
    if (view.kind === "table") expect(view.columns.map((c) => c.format)).toEqual(["text", "number"])
  })
})

describe("table totals", () => {
  const p = plan({
    chartType: "table",
    columns: [
      { key: "k", label: "Ürün", format: "text", total: false },
      { key: "f", label: "Birim Fiyat", format: "currency", total: false },
      { key: "v", label: "Tutar", format: "currency", total: true },
    ],
  })

  it("sums only columns declared summable, over all rows", () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ k: `u${i}`, f: 10, v: 0.1 }))
    const view = resolveView(p, rows, ["k", "f", "v"])
    expect(view.kind).toBe("table")
    if (view.kind !== "table") return
    expect(view.rows).toHaveLength(500)
    expect(view.totals).toEqual({ v: 60 })
  })

  it("adds no total for a single row", () => {
    const view = resolveView(p, [{ k: "a", f: 1, v: 5 }], ["k", "f", "v"])
    if (view.kind === "table") expect(view.totals).toEqual({})
  })
})

describe("partial results", () => {
  it("never draws charts or totals from a cut-off result", () => {
    const p = plan({ chartType: "pie", columns: [{ key: "k", label: "K", format: "text", total: false }, { key: "v", label: "V", format: "currency", total: true }] })
    const rows = [{ k: "a", v: 1 }, { k: "b", v: 2 }]
    const view = resolveView(p, rows, ["k", "v"], false)
    expect(view.kind).toBe("table")
    if (view.kind === "table") {
      expect(view.partial).toBe(true)
      expect(view.totals).toEqual({})
    }
  })

  it("shows very long lines as a table instead of freezing the SVG", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ k: `2026-01-${String(i).padStart(5, "0")}`, v: i }))
    expect(resolveView(plan({ chartType: "line" }), rows, ["k", "v"]).kind).toBe("table")
  })
})
