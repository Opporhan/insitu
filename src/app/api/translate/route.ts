import { messages, requestLocale } from "@/lib/i18n"
import { checkDailyBudget } from "@/lib/daily-budget"
import { clientIp, createRateLimiter } from "@/lib/rate-limit"
import { TranslateRequest, type TranslateResponse } from "@/lib/schema"
import { translator } from "@/lib/translator"

// Protects the Gemini quota on a public deployment: 10 requests per IP per minute.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 })

/** A real request (question, ≤ 200 column names, ≤ 3 earlier turns) is a few KB. */
const MAX_BODY_BYTES = 64 * 1024

// Three model fallbacks × 30 s is the worst case; stop well before a runaway invocation.
export const maxDuration = 60

/**
 * The only server endpoint. Receives the question and column headers — never
 * row data (the strict schema rejects any extra field) — and returns a query plan.
 */
export async function POST(request: Request): Promise<Response> {
  // The body is not read yet, so the language comes from the cookie / Accept-Language.
  const headerLocale = requestLocale(request.headers.get("cookie"), request.headers.get("accept-language"))
  const limit = limiter.check(clientIp(request))
  if (!limit.ok) {
    return Response.json(
      {
        ok: false,
        error: messages[headerLocale].server.rateLimited(limit.retryAfterSec),
        suggestions: [],
      } satisfies TranslateResponse,
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    )
  }

  const raw = await request.text().catch(() => "")
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return Response.json(
      { ok: false, error: messages[headerLocale].server.invalid, suggestions: [] } satisfies TranslateResponse,
      { status: 413 },
    )
  }
  const body: unknown = (() => {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  })()
  const parsed = TranslateRequest.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: messages[headerLocale].server.invalid, suggestions: [] } satisfies TranslateResponse,
      { status: 400 },
    )
  }
  // Counted only for valid requests, right before the paid call.
  const budget = await checkDailyBudget()
  if (!budget.ok) {
    return Response.json(
      { ok: false, error: messages[headerLocale].server.dailyLimit, suggestions: [] } satisfies TranslateResponse,
      { status: 429, headers: { "Retry-After": String(budget.retryAfterSec) } },
    )
  }
  return Response.json(await translator.translate(parsed.data))
}
