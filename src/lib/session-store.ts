import { z } from "zod"
import { QueryPlan, type Column } from "@/lib/schema"

/**
 * Earlier questions of a file, kept in this browser so reopening the same file can bring them
 * back. Only what the user typed and the generated SQL/plan is stored — never rows or results;
 * answers are recomputed locally from the file when restored.
 */

const VERSION = "v1"
export const MAX_SAVED = 20

const Saved = z.array(z.object({ question: z.string(), plan: QueryPlan })).max(MAX_SAVED)
export type SavedQuestion = z.infer<typeof Saved>[number]

/** Same name, same row count and same columns: treated as the same file. */
export function sessionKey(fileName: string, rowCount: number, columns: readonly Column[]): string {
  const shape = columns.map((c) => `${c.name}:${c.type}`).join(",")
  let hash = 5381
  for (let i = 0; i < shape.length; i++) hash = ((hash << 5) + hash + shape.charCodeAt(i)) >>> 0
  return `insitu-session:${VERSION}:${fileName}:${rowCount}:${hash.toString(36)}`
}

/** Storage can be unavailable (private mode, blocked site data); nothing then is saved. */
export function loadSaved(key: string): SavedQuestion[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = Saved.safeParse(raw ? JSON.parse(raw) : [])
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export function saveQuestions(key: string, questions: readonly SavedQuestion[]): void {
  try {
    if (questions.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(questions.slice(0, MAX_SAVED)))
  } catch {
    // Quota or blocked storage: the session simply is not remembered.
  }
}
