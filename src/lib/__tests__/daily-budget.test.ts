import { describe, expect, it } from "vitest"
import { checkDailyBudget } from "@/lib/daily-budget"

const fake = (count: number | null, status = 200) =>
  (async () => new Response(JSON.stringify([{ result: count }, { result: 1 }]), { status })) as unknown as typeof fetch

const env = { url: "https://example.upstash.io", token: "t", limit: "3" }
const now = new Date("2026-09-27T21:00:00Z")

describe("checkDailyBudget", () => {
  it("allows everything when Upstash is not configured", async () => {
    expect(await checkDailyBudget({}, now, fake(999))).toEqual({ ok: true })
  })

  it("stops after the daily limit until UTC midnight", async () => {
    expect(await checkDailyBudget(env, now, fake(3))).toEqual({ ok: true })
    expect(await checkDailyBudget(env, now, fake(4))).toEqual({ ok: false, retryAfterSec: 3 * 3600 })
  })

  it("serves requests when the counter is unreachable (cost guard, not a blocker)", async () => {
    expect(await checkDailyBudget(env, now, fake(null, 500))).toEqual({ ok: true })
    const failing = (async () => {
      throw new Error("network")
    }) as unknown as typeof fetch
    expect(await checkDailyBudget(env, now, failing)).toEqual({ ok: true })
  })
})
