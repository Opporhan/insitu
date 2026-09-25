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
