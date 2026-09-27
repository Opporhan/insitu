import { z } from "zod"
import { MAX_SQL_CHARS, QueryPlan } from "@/lib/schema"

/**
 * Share links carry a session's questions and their plans (SQL, chart, labels) — never data.
 * They live in the URL fragment ("#analiz=…"), which browsers do not send to the server. The
 * receiver loads their own file; the plans then run in their browser, through the same SQL
 * guard as every query, so a crafted link can at most compute something about their own file.
 */

export const SHARE_KEY = "analiz"
export const MAX_SHARED = 20

const SharedItem = z.object({
  question: z.string().trim().min(1).max(500),
  plan: QueryPlan.refine((p) => p.sql.length <= MAX_SQL_CHARS, "sql too long"),
})
const Payload = z.object({ v: z.literal(1), items: z.array(SharedItem).min(1).max(MAX_SHARED) })
export type SharedItem = z.infer<typeof SharedItem>

/** Links longer than this are refused rather than truncated. */
const MAX_FRAGMENT_CHARS = 60_000

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

/** "#analiz=<deflated JSON, base64url>" for the given questions (the newest 20). */
export async function encodeShare(items: readonly SharedItem[]): Promise<string> {
  const payload = Payload.parse({ v: 1, items: items.slice(0, MAX_SHARED) })
  const json = new TextEncoder().encode(JSON.stringify(payload))
  return `#${SHARE_KEY}=${toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))}`
}

/** The questions of a share fragment, or null when there is none or it is invalid. */
export async function decodeShare(fragment: string): Promise<SharedItem[] | null> {
  const match = new RegExp(`^#${SHARE_KEY}=([A-Za-z0-9_-]+)$`).exec(fragment)
  if (!match?.[1] || match[1].length > MAX_FRAGMENT_CHARS) return null
  try {
    const json = await pipe(fromBase64Url(match[1]), new DecompressionStream("deflate-raw"))
    // A tiny fragment must not inflate into something huge.
    if (json.length > 2_000_000) return null
    const parsed = Payload.safeParse(JSON.parse(new TextDecoder().decode(json)))
    return parsed.success ? parsed.data.items : null
  } catch {
    return null
  }
}
