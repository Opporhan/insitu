import { describe, expect, it } from "vitest"
import { formatRatio, formatValue } from "@/lib/format"

// Intl output uses narrow/no-break spaces in some locales; normalize for comparison.
const n = (s: string) => s.replace(/[  ]/g, " ")

describe("formatValue", () => {
  it("formats Turkish lira with the ₺ sign and Turkish separators", () => {
    expect(n(formatValue(1234567.5, "currency"))).toBe("₺1.234.567,50")
    expect(n(formatValue(1299, "currency"))).toBe("₺1.299")
    expect(n(formatValue(0.1 + 0.2, "currency"))).toBe("₺0,30")
    expect(n(formatValue(-450, "currency"))).toBe("-₺450")
  })

  it("compacts currency only in short (axis) mode", () => {
    expect(n(formatValue(2_500_000, "currency", true))).toMatch(/^₺2,5 ?Mn$/)
    expect(n(formatValue(9_999, "currency", true))).toBe("₺9.999")
  })

  it("formats integers, decimals and 0–100 percentages", () => {
    expect(formatValue(1726, "integer")).toBe("1.726")
    expect(formatValue(1.23456, "number")).toBe("1,23")
    expect(formatValue(24.6, "percent")).toBe("%24,6")
    expect(formatValue(0.456, "percent")).toBe("%0,46")
  })

  it("formats dates and months in Turkish", () => {
    expect(formatValue("2026-09-25", "date")).toBe("25 Eyl 2026")
    expect(formatValue("2026-02", "month")).toBe("Şubat 2026")
    expect(formatValue("2026-02", "month", true)).toBe("Şub 26")
  })

  it("never invents values", () => {
    expect(formatValue(null, "currency")).toBe("—")
    expect(formatValue(Number.NaN, "currency")).toBe("—")
    expect(formatValue("abc", "date")).toBe("abc")
    expect(formatValue("İstanbul", "text")).toBe("İstanbul")
  })

  it("formats ratios", () => {
    expect(formatRatio(0.246)).toBe("%24,6")
    expect(formatRatio(1)).toBe("%100")
  })
})

describe("formatValue (English)", () => {
  it("keeps lira but uses English separators", () => {
    expect(n(formatValue(1234567.5, "currency", false, "en"))).toBe("₺1,234,567.50")
    expect(n(formatValue(1299, "currency", false, "en"))).toBe("₺1,299")
    expect(n(formatValue(2_500_000, "currency", true, "en"))).toBe("₺2.5M")
  })
  it("formats percent, numbers and dates in English", () => {
    expect(formatValue(24.6, "percent", false, "en")).toBe("24.6%")
    expect(formatValue(1726, "integer", false, "en")).toBe("1,726")
    expect(formatValue("2026-09-25", "date", false, "en")).toBe("Sep 25, 2026")
    expect(formatValue("2026-02", "month", false, "en")).toBe("February 2026")
    expect(formatValue("2026-02", "month", true, "en")).toBe("Feb 26")
  })
})
