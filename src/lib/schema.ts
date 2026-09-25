import { z } from "zod"
import { LOCALES } from "@/lib/i18n"

/**
 * Privacy boundary. `TranslateRequest` is the only payload that ever leaves the
 * browser: column names + coarse types (and, for a repair, the generated SQL and a
 * masked engine error). It is a strict object, so any extra field (e.g. sample rows)
 * is rejected by the server.
 */
export const ColumnType = z.enum(["number", "text", "date"])
export type ColumnType = z.infer<typeof ColumnType>

export const Column = z.strictObject({
  name: z.string().min(1).max(128),
  type: ColumnType,
})
export type Column = z.infer<typeof Column>

export const RepairContext = z.strictObject({
  sql: z.string().min(1).max(8000),
  error: z.string().min(1).max(600),
})
export type RepairContext = z.infer<typeof RepairContext>

export const TranslateRequest = z.strictObject({
  question: z.string().trim().min(2).max(500),
  columns: z.array(Column).min(1).max(200),
  repair: RepairContext.optional(),
  /** UI language: the plan's title, labels and explanations are written in it. */
  locale: z.enum(LOCALES).optional(),
})
export type TranslateRequest = z.infer<typeof TranslateRequest>

export const ChartType = z.enum(["metric", "bar", "line", "pie", "table"])
export type ChartType = z.infer<typeof ChartType>

/** How a result column is displayed. `percent` values are already on a 0–100 scale. */
export const ValueFormat = z.enum(["currency", "number", "integer", "percent", "text", "date", "month"])
export type ValueFormat = z.infer<typeof ValueFormat>

export const OutputColumn = z.strictObject({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  format: ValueFormat,
  /** Whether summing this column over the rows is meaningful (amounts, quantities — not prices or averages). */
  total: z.boolean(),
})
export type OutputColumn = z.infer<typeof OutputColumn>

/** What the translator returns. Keys refer to the aliases in the SQL's final SELECT. */
export const QueryPlan = z.strictObject({
  sql: z.string().min(1),
  chartType: ChartType,
  xAxisKey: z.string(),
  yAxisKey: z.string(),
  seriesKey: z.string(),
  title: z.string().min(1).max(120),
  columns: z.array(OutputColumn).min(1).max(20),
})
export type QueryPlan = z.infer<typeof QueryPlan>

export const TranslateResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), plan: QueryPlan }),
  z.object({ ok: z.literal(false), error: z.string(), suggestions: z.array(z.string()) }),
])
export type TranslateResponse = z.infer<typeof TranslateResponse>

export const ResultValue = z.union([z.number(), z.string(), z.null()])
export type ResultValue = z.infer<typeof ResultValue>

export const ResultRow = z.record(z.string(), ResultValue)
export type ResultRow = z.infer<typeof ResultRow>
