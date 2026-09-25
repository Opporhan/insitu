import { describe, expect, it } from "vitest"
import { preciseSum } from "@/lib/math"

describe("preciseSum", () => {
  it("does not drift like naive float addition", () => {
    const values = Array.from({ length: 10_000 }, () => 0.1)
    expect(values.reduce((a, b) => a + b, 0)).not.toBe(1000)
    expect(preciseSum(values)).toBe(1000)
  })

  it("handles mixed magnitudes and signs", () => {
    expect(preciseSum([1e16, 1, -1e16])).toBe(1)
    expect(preciseSum([])).toBe(0)
  })
})
