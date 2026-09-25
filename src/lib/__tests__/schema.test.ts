import { describe, expect, it } from "vitest"
import { TranslateRequest } from "@/lib/schema"

describe("TranslateRequest privacy boundary", () => {
  const valid = { question: "ilk 3 ürün", columns: [{ name: "urun", type: "text" }] }

  it("accepts question + column headers", () => {
    expect(TranslateRequest.safeParse(valid).success).toBe(true)
  })

  it("rejects payloads carrying row data", () => {
    expect(TranslateRequest.safeParse({ ...valid, rows: [{ urun: "Termos" }] }).success).toBe(false)
  })

  it("rejects sample values smuggled into a column", () => {
    const columns = [{ name: "urun", type: "text", sample: "Termos" }]
    expect(TranslateRequest.safeParse({ ...valid, columns }).success).toBe(false)
  })
})

describe("TranslateRequest history", () => {
  const base = { question: "ve kaç adet satılmış", columns: [{ name: "urun", type: "text" }] }
  const turn = { question: "bu ay en çok satan 3 ürün", sql: "SELECT 1" }

  it("accepts up to 3 earlier question + SQL turns", () => {
    expect(TranslateRequest.safeParse({ ...base, history: [turn, turn, turn] }).success).toBe(true)
    expect(TranslateRequest.safeParse({ ...base, history: [turn, turn, turn, turn] }).success).toBe(false)
  })

  it("rejects result values smuggled into history", () => {
    expect(TranslateRequest.safeParse({ ...base, history: [{ ...turn, rows: [{ urun: "Tablet", adet: 41 }] }] }).success).toBe(false)
    expect(TranslateRequest.safeParse({ ...base, history: [{ ...turn, insight: "Tablet 41 adet" }] }).success).toBe(false)
  })
})
