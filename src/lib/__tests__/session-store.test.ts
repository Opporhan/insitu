import { beforeEach, describe, expect, it } from "vitest"
import { loadSaved, MAX_SAVED, saveQuestions, sessionKey } from "@/lib/session-store"
import type { QueryPlan } from "@/lib/schema"

const plan: QueryPlan = {
  sql: 'SELECT SUM("tutar") AS t FROM data',
  chartType: "metric",
  xAxisKey: "",
  yAxisKey: "",
  seriesKey: "",
  title: "Toplam",
  note: "",
  columns: [{ key: "t", label: "Toplam", format: "currency", total: false }],
}

beforeEach(() => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage
})

describe("session store", () => {
  it("keys by file name, row count and column shape", () => {
    const cols = [{ name: "tutar", type: "number" as const }]
    expect(sessionKey("a.csv", 10, cols)).toBe(sessionKey("a.csv", 10, cols))
    expect(sessionKey("a.csv", 10, cols)).not.toBe(sessionKey("a.csv", 11, cols))
    expect(sessionKey("a.csv", 10, cols)).not.toBe(sessionKey("a.csv", 10, [{ name: "tutar", type: "text" }]))
  })

  it("stores questions and plans only, capped, and ignores corrupt data", () => {
    const key = "k"
    saveQuestions(key, Array.from({ length: MAX_SAVED + 5 }, (_, i) => ({ question: `soru ${i}`, plan })))
    expect(loadSaved(key)).toHaveLength(MAX_SAVED)
    localStorage.setItem(key, "{not json")
    expect(loadSaved(key)).toEqual([])
    saveQuestions(key, [])
    expect(localStorage.getItem(key)).toBeNull()
  })
})
