import { describe, expect, it } from "vitest"
import { clientIp, createRateLimiter } from "@/lib/rate-limit"

describe("createRateLimiter", () => {
  it("allows 10 per minute per key, then blocks with a correct retry time", () => {
    const rl = createRateLimiter({ limit: 10, windowMs: 60_000 })
    for (let i = 0; i < 10; i++) expect(rl.check("1.1.1.1", 1_000 + i * 1_000).ok).toBe(true)
    expect(rl.check("1.1.1.1", 15_000)).toEqual({ ok: false, retryAfterSec: 46 })
    // Other clients are unaffected.
    expect(rl.check("2.2.2.2", 15_000).ok).toBe(true)
  })

  it("slides: a request becomes available once the oldest leaves the window", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000 })
    rl.check("k", 0)
    rl.check("k", 30_000)
    expect(rl.check("k", 59_999).ok).toBe(false)
    expect(rl.check("k", 60_001).ok).toBe(true)
    expect(rl.check("k", 60_002).ok).toBe(false)
  })

  it("rejected requests do not extend the block", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1_000 })
    rl.check("k", 0)
    for (let t = 100; t < 1_000; t += 100) expect(rl.check("k", t).ok).toBe(false)
    expect(rl.check("k", 1_001).ok).toBe(true)
  })

  it("bounds memory by evicting the stalest key", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 })
    rl.check("a", 0)
    rl.check("b", 1)
    rl.check("c", 2) // evicts "a"
    expect(rl.check("a", 3).ok).toBe(true)
    expect(rl.check("c", 4).ok).toBe(false)
  })
})

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://x", { headers })
  it("uses the first x-forwarded-for entry", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7")
  })
  it("falls back to x-real-ip, then a shared bucket", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2")
    expect(clientIp(req({}))).toBe("unknown")
  })
})
