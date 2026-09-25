export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSec: number }

export type RateLimiter = {
  check(key: string, now?: number): RateLimitResult
}

type Options = {
  limit: number
  windowMs: number
  /** Upper bound on tracked keys so a flood of distinct IPs cannot grow memory without limit. */
  maxKeys?: number
}

/**
 * In-memory sliding-window limiter. State lives in one server instance, so on
 * serverless platforms each warm instance counts separately — a speed bump for
 * casual abuse, not a hard global quota.
 */
export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }: Options): RateLimiter {
  const hits = new Map<string, number[]>()

  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs)
      // Re-insert so Map order tracks recency; the first key is then the stalest.
      hits.delete(key)

      const oldest = recent[0]
      if (recent.length >= limit && oldest !== undefined) {
        hits.set(key, recent)
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) }
      }

      recent.push(now)
      hits.set(key, recent)
      if (hits.size > maxKeys) {
        const stalest = hits.keys().next().value
        if (stalest !== undefined) hits.delete(stalest)
      }
      return { ok: true, remaining: limit - recent.length }
    },
  }
}

/** Client IP as reported by the proxy (Vercel sets x-forwarded-for to the real client IP). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown"
}
