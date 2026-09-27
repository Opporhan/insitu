/**
 * A global daily cap on translator requests, shared by every server instance, so a public
 * deployment can never run up an unbounded Gemini bill. It uses Upstash Redis over its REST
 * API and is active only when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set;
 * without them (local development) every request is allowed.
 */

export type BudgetResult = { ok: true } | { ok: false; retryAfterSec: number }

type Env = { url?: string | undefined; token?: string | undefined; limit?: string | undefined }

const DEFAULT_DAILY_LIMIT = 2000

/** Seconds until the next UTC midnight, when the counter starts again. */
function secondsToMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

export async function checkDailyBudget(
  env: Env = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
    limit: process.env.INSITU_DAILY_LIMIT,
  },
  now: Date = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<BudgetResult> {
  if (!env.url || !env.token) return { ok: true }
  const limit = Number(env.limit) > 0 ? Number(env.limit) : DEFAULT_DAILY_LIMIT
  const key = `insitu:translate:${now.toISOString().slice(0, 10)}`
  try {
    const res = await fetcher(`${env.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, "172800"],
      ]),
      signal: AbortSignal.timeout(2000),
    })
    const body = (await res.json()) as { result?: unknown }[]
    const count = Number(body[0]?.result)
    if (!res.ok || !Number.isFinite(count)) throw new Error(`upstash ${res.status}`)
    return count > limit ? { ok: false, retryAfterSec: secondsToMidnight(now) } : { ok: true }
  } catch (e) {
    // The counter is a cost guard, not a correctness one: if it is unreachable, serve the request.
    console.error("[daily-budget] unavailable:", e instanceof Error ? e.message : e)
    return { ok: true }
  }
}
