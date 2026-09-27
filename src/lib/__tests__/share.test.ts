import { describe, expect, it } from "vitest"
import type { QueryPlan } from "@/lib/schema"
import { decodeShare, encodeShare, MAX_SHARED } from "@/lib/share"

const plan = (sql: string): QueryPlan => ({
  sql,
  chartType: "bar",
  xAxisKey: "sehir",
  yAxisKey: "ciro",
  seriesKey: "",
  title: "Şehirlere göre ciro",
  note: "",
  columns: [
    { key: "sehir", label: "Şehir", format: "text", total: false },
    { key: "ciro", label: "Ciro", format: "currency", total: true },
  ],
})

describe("share links", () => {
  it("round-trips questions and plans through a compact URL fragment", async () => {
    const items = [{ question: "Şehirlere göre ciro", plan: plan('SELECT "sehir", SUM("tutar") AS ciro FROM data GROUP BY 1') }]
    const fragment = await encodeShare(items)
    expect(fragment).toMatch(/^#analiz=[A-Za-z0-9_-]+$/)
    expect(await decodeShare(fragment)).toEqual(items)
  })

  it("keeps at most 20 analyses", async () => {
    const items = Array.from({ length: MAX_SHARED + 5 }, (_, i) => ({ question: `Soru ${i}`, plan: plan(`SELECT ${i} AS x`) }))
    expect(await decodeShare(await encodeShare(items))).toHaveLength(MAX_SHARED)
  })

  it("rejects anything that is not a valid share: garbage, extra fields, oversized SQL", async () => {
    expect(await decodeShare("#analiz=!!!")).toBeNull()
    expect(await decodeShare("#analiz=AAAA")).toBeNull()
    expect(await decodeShare("#baska=abc")).toBeNull()
    const tooLong = { question: "x", plan: plan(`SELECT '${"a".repeat(5000)}'`) }
    await expect(encodeShare([tooLong])).rejects.toThrow()
  })
})
