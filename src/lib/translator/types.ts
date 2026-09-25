import type { TranslateRequest, TranslateResponse } from "@/lib/schema"

/** Turns a question + column headers into a query plan. Never sees row data. */
export interface QueryTranslator {
  translate(request: TranslateRequest): Promise<TranslateResponse>
}
